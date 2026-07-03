# quiescent

Edit documents in a git repo from the browser, deployed on Cloudflare Workers.
Authenticate against a git forge, edit markdown with CodeMirror, and let
quiescent quietly persist your work:

- **Notes mode** (you have push access) — edits accumulate as drafts and are
  flushed to commits on the default branch when you stop typing, press
  Ctrl/Cmd+S, or a cron trigger notices a stale draft.
- **Contributor mode** (no push access) — your edits become a branch and a
  pull request, like "suggest an edit" on a docs or blog site.

All git operations use forge HTTP APIs (no git binary). Supported forges:
GitHub, Gitea, Forgejo, and Codeberg. The Gitea/Forgejo/Codeberg client is
implemented but not yet tested against a live instance.

## Layout

Bun workspace with packages under `code/`:

| Package | Purpose |
| --- | --- |
| `@ncrmro/quiescent-git` | Forge API abstraction: contents, multi-file commits, branches, pull requests, forks, OAuth |
| `@ncrmro/quiescent-editor` | CodeMirror 6 markdown editor with idle detection (the flush-on-stop signal) |
| `@ncrmro/quiescent-web` | Astro app on Cloudflare Workers: auth, KV drafts/sessions, cron flush |

## Development

The dev shell is provided by [devenv](https://devenv.sh) (`direnv allow` on
first use).

```sh
bun install
bun test                      # code/git + code/editor unit tests
bun run typecheck             # tsc / astro check per package
cd code/web
cp .dev.vars.example .dev.vars   # fill in OAuth app credentials
bun run dev                   # astro dev with Cloudflare platform proxy
bun run build && bun run preview # wrangler dev against the built worker
```

## Deployment

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
