# Deploying a quiescent wiki on Cloudflare Workers

An Astro site with `quiescentWiki()` for viewing/search/tags/graph, plus
`@quiescent/server` routes for editing. One deployment edits one repo.

## Choose an auth mode

**Forge OAuth** (original quiescent): users log in against
GitHub/Gitea/Forgejo/Codeberg and commit with their own tokens. Needs
`SESSIONS` KV, `OAUTH_CLIENT_ID`/`OAUTH_CLIENT_SECRET`/`SESSION_SECRET`, and
the auth routes from `code/web/src/pages/auth/`.

**Host auth + service token**: your app already authenticates users
(better-auth, anything). Set `SERVICE_TOKEN` to a forge credential — for
GitHub a fine-grained PAT scoped to the one repo with **Contents:
read/write** — and skip SESSIONS/OAUTH entirely. Commits are authored as the
editing user (git author override + `Co-authored-by` trailer) through the
service token; they show as unverified on GitHub, which is expected.
**A user without an email cannot flush**: `flushDrafts` throws
`MissingAuthorEmailError` before any forge call — surface it as "set an email
on your account to save edits" (the example flush route returns 422
`{"error": "missing-email"}`).

Trust model: anyone your auth admits can commit through the service token
with an arbitrary author header. Fine for a small allowlist; not for open
registration.

### better-auth adapter recipe

```ts
// src/lib/quiescent-auth.ts — in your app, not a package dependency
import type { AuthAdapter } from "@quiescent/server";
import { resolveAuth } from "./auth"; // however your app builds better-auth

export const authAdapter: AuthAdapter = {
  async getUser(request) {
    const auth = await resolveAuth();
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user) return null;
    const { name, email } = session.user;
    // Key drafts by email: memory-adapter ids change across restarts.
    return { id: email, name, email, canPush: true };
  },
};
```

Set `locals.user = await authAdapter.getUser(request, env)` in your
middleware (or per-route) before the draft/flush routes run.

## Setup

1. KV namespaces (`SESSIONS` only in forge-OAuth mode):

   ```sh
   wrangler kv namespace create DRAFTS
   wrangler kv namespace create SESSIONS   # forge-OAuth mode only
   ```

2. `wrangler.jsonc` vars: `FORGE_KIND` (`github|gitea|forgejo|codeberg`),
   `FORGE_BASE_URL` (gitea/forgejo), `REPO_OWNER`, `REPO_NAME`,
   `DEFAULT_BRANCH`; cron for stale-draft flushing:

   ```jsonc
   "triggers": { "crons": ["*/5 * * * *"] }
   ```

3. Secrets: `wrangler secret put SERVICE_TOKEN` — or the OAuth trio in
   forge-OAuth mode (see repo root README).

4. Copy the thin glue from `code/web/src/`: draft + flush API routes, edit
   pages, worker entry whose `scheduled` handler calls `flushStaleDrafts`,
   and the wiki demo routes (`pages/wiki-demo/`, `pages/api/wiki/`) adapted
   to your site.

## Read-your-writes: redeploy on wiki pushes

Content is baked at build time, so a flushed commit appears after the next
deploy. Add a workflow so wiki edits redeploy the site (~1–2 min staleness):

```yaml
# .github/workflows/deploy-wiki.yml
on:
  push:
    branches: [main]
    paths: ["wiki/**"]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install
      - run: bun run deploy   # astro build && wrangler deploy
        working-directory: code/wiki-app
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
```

While a draft is pending (saved but not yet flushed/deployed), show a banner
on the note page by checking `getDraft(env, user.id, path)` and preferring
the draft content.
