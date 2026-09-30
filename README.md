# quiescent

For the GitHub-backed formatted writing and publishing prototype, see
[Writing with Quiescent](docs/writing-prototype.md). It runs on self-hosted Node or Cloudflare Workers,
uses workspace packages without npm releases, and publishes without PRs.

npm packages for editing documents in a git repo from the browser, and for
turning a directory of markdown into a wiki (search, tags, note graph). Edit
markdown with CodeMirror and let quiescent quietly persist your work:

- **Notes mode** (push access) — edits accumulate as drafts and are flushed
  to commits on the default branch when you stop typing, press Ctrl/Cmd+S,
  or a cron trigger notices a stale draft.
- **Contributor mode** (no push access) — your edits become a branch and a
  pull request, like "suggest an edit" on a docs or blog site.

Two auth modes decide whose credential commits:

- **Forge OAuth** — users log in against the forge and commit with their own
  token (the original mode).
- **Host auth + service token** — your app already has auth (e.g.
  better-auth); a single forge token (`SERVICE_TOKEN`) authors commits
  attributed to the editing user via git author override + `Co-authored-by`.
  A user without an email cannot flush (`MissingAuthorEmailError`) — the
  service token never authors an unattributable commit.

All git operations use forge HTTP APIs (no git binary). Supported forges:
GitHub, Gitea, Forgejo, and Codeberg. The Gitea/Forgejo/Codeberg client is
implemented but not yet tested against a live instance.

The packages are deployment-agnostic: storage is a small `KeyValueStore`
interface (Cloudflare KV satisfies it structurally; self-hosted deployments
bring Redis, SQLite, or the in-memory store). Cloudflare Workers is the
first supported target — the example app below — with self-hosted Node as a
planned second.

## Layout

Bun workspace with packages under `code/`:

| Package | Published | Purpose |
| --- | --- | --- |
| `@quiescent/git` | npm | Forge API abstraction: contents, multi-file commits, branches, pull requests, forks, OAuth |
| `@quiescent/server` | npm | Worker-side sessions, KV drafts, and flush-to-commit logic |
| `@quiescent/editor` | npm | CodeMirror 6 markdown editor with idle detection (the flush-on-stop signal) |
| `@quiescent/wiki` | npm | Astro wiki toolkit: wikilinks remark plugin, tag index, MiniSearch index, d3-force note graph, all baked at build time (`virtual:quiescent-wiki`) |
| `@quiescent/web` | no (example) | Reference Astro app on Cloudflare Workers wiring the packages together: auth routes, draft API, cron flush, and the `/demo` blog + wiki apps |

Consumers (e.g. [ncrmro/website](https://github.com/ncrmro/website)) install
the published packages and copy the thin Astro glue from `code/web`
(middleware, auth/draft/flush routes, worker entry) into their own site.

Docs: [content conventions](docs/conventions.md) ·
[deploy on Cloudflare](docs/deploy-cloudflare.md) ·
[deploy in a container](docs/deploy-container.md) ·
[`@quiescent/wiki` API](code/wiki/README.md)

## Demos

`code/web` serves two demo apps under `/demo`, showing the two shapes a
consumer usually wants:

- **`/demo/blog`** — posts in a content directory, edited in the browser;
  typing saves a draft, going idle (or Ctrl/Cmd+S) commits it, and the post
  re-renders from the commit.
- **`/demo/wiki`** — `@quiescent/wiki` resolving `[[wikilinks]]`, plus tag
  browsing, client-side search, and the note graph.

Both run the published packages against an in-memory `KeyValueStore` and a
stubbed forge injected through `Env.fetch`, so they need no OAuth app, token,
or KV binding — `devenv up web`, then open <http://localhost:4000/demo>.
Playwright drives them (`bun run test:e2e`); browsers come from the
Nix-managed bundle in `devenv.nix`, so don't run `playwright install`.

## Releases

[release-please](https://github.com/googleapis/release-please) manages
versioning from Conventional Commits. Merging the release PR tags every
changed package, and the `publish` job pushes each one to npm with
`npm publish` over [trusted publishing][tp] — the workflow exchanges its
GitHub OIDC token with the registry, so no `NPM_TOKEN` is stored anywhere
and releases carry provenance.

All four published packages (`git`, `server`, `editor`, `wiki`) are in
`release-please-config.json`; `@quiescent/web` is the private example app and
stays unpublished. The `node-workspace` plugin keeps the cross-package
dependency ranges (`@quiescent/server` → `@quiescent/git`) in step with each
release. Those ranges are real semver, not `workspace:*` — npm does not
rewrite the workspace protocol at publish time, so a `workspace:*` range
would ship a package nobody can install.

**Bootstrapping a new package:** trusted publishing is configured on a
package's npm settings page, which requires the package to already exist
([npm/cli#8544](https://github.com/npm/cli/issues/8544)). Publish the first
version by hand, then hand it over:

```sh
cd code/<pkg> && npm publish --access public
# then add the trusted publisher (this repo + release-please.yml) at
# https://www.npmjs.com/package/@quiescent/<pkg>/access
```

[tp]: https://docs.npmjs.com/trusted-publishers

## Development

The dev shell is provided by [devenv](https://devenv.sh) (`direnv allow` on
first use).

```sh
bun install
bun test                      # unit tests across the packages
bun run typecheck             # tsc / astro check per package
bun run test:e2e              # Playwright specs driving the /demo apps
cd code/web
cp .dev.vars.example .dev.vars   # fill in OAuth app credentials
bun run dev                   # astro dev with Cloudflare platform proxy
bun run build && bun run preview # wrangler dev against the built worker
```

## Consuming in your own Astro + Cloudflare site

The intended use: install `@quiescent/{git,server,editor}` and copy the thin
glue from `code/web` into your site, mounted under a prefix so the public
site is untouched (see
[ncrmro/website](https://github.com/ncrmro/website) for a real example
mounted at `/admin`):

- middleware guarding the editor prefix and its API routes
- auth routes (`login`/`callback`/`logout`); set the `OAUTH_CALLBACK_PATH`
  var when the callback isn't at `/auth/callback`
- draft + flush API routes, editor page, and a custom worker entry whose
  `scheduled` handler calls `flushStaleDrafts` on a cron trigger
- `SESSIONS`/`DRAFTS` KV namespaces (any `KeyValueStore` works; KV is the
  Cloudflare-shaped one) and the `FORGE_KIND`/`REPO_OWNER`/`REPO_NAME`/
  `DEFAULT_BRANCH` vars, plus `OAUTH_CLIENT_ID`/`OAUTH_CLIENT_SECRET`/
  `SESSION_SECRET` secrets

## Deploying the example app

One deployment edits one repo, configured in `code/web/wrangler.jsonc` `vars`:
`FORGE_KIND` (`github` | `gitea` | `forgejo` | `codeberg`), `FORGE_BASE_URL`
(required for gitea/forgejo), `REPO_OWNER`, `REPO_NAME`, `DEFAULT_BRANCH`.

1. Create the KV namespaces and paste their ids into `wrangler.jsonc`:

   ```sh
   wrangler kv namespace create SESSIONS
   wrangler kv namespace create DRAFTS
   ```

2. Register an OAuth app on your forge (see below) and set secrets:

   ```sh
   wrangler secret put OAUTH_CLIENT_ID
   wrangler secret put OAUTH_CLIENT_SECRET
   openssl rand -hex 32 | wrangler secret put SESSION_SECRET
   ```

3. `bun run deploy` (astro build + wrangler deploy). The cron trigger
   (`*/5 * * * *`) flushes drafts idle for more than five minutes.

### GitHub App registration

1. GitHub → Settings → Developer settings → **New GitHub App**.
2. Callback URL: `https://<your-worker-domain>/auth/callback`; enable
   **Request user authorization (OAuth) during installation**; webhooks off.
3. Repository permissions: **Contents: Read and write**, **Pull requests:
   Read and write**.
4. Install the app on the target repo, then use the app's client id/secret
   as `OAUTH_CLIENT_ID` / `OAUTH_CLIENT_SECRET`.

User-to-server tokens expire after ~8 hours; quiescent refreshes them
automatically with the stored refresh token (including from the cron flush).

### Gitea / Forgejo / Codeberg OAuth2 app

1. Settings → Applications → **Create a new OAuth2 application**.
2. Redirect URI: `https://<your-worker-domain>/auth/callback`.
3. Set `FORGE_KIND` (and `FORGE_BASE_URL` for self-hosted instances;
   Codeberg defaults to `https://codeberg.org`).

## How flushing works

Edits autosave as drafts to the `DRAFTS` KV namespace (`draft:{userId}:{path}`).
A flush turns all of a user's drafts into a single commit:

- editor idle for 30s, Ctrl/Cmd+S, or the "Commit now" button → `POST /api/flush`
- tab closed mid-edit → `sendBeacon` persists the draft; the cron trigger
  flushes it later using the tokens stored on the session that produced it

With push access the commit lands on `DEFAULT_BRANCH`; otherwise quiescent
creates `quiescent/{login}/{timestamp}` (falling back to a fork when branch
creation is denied) and opens a pull request.
