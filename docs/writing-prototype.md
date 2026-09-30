# Writing with Quiescent

The example provides one workflow: write, save privately, publish, revise, and
delete. GitHub is the content backend. Quiescent owns the Git operations, editor,
media validation, and publication/cache lifecycle. The example supplies its
password gate, page presentation, and runtime adapters. No npm releases are needed.

Posts demonstrate the [general document store](document-store.md): title,
description, editable slug, tags, header image, and body are one editor and one
atomic save. GitHub stores Markdown with schema-validated YAML front matter.
Existing JSON posts convert when edited; no bulk migration or npm release is needed.

## Run the self-hosted example

Use Node on a single server, with a private GitHub repository initialized on `main`:

```sh
devenv shell -- bun install --frozen-lockfile
devenv shell -- bun run build:node
# Supply SERVICE_TOKEN through your environment or secret manager.
WRITING_REPO_OWNER=ncrmro WRITING_REPO_NAME=your-content-repo \
  devenv shell -- bun run start:node
```

`SERVICE_TOKEN` is a fine-grained GitHub PAT with Contents read/write for the
content repository. It remains on the server. No GitHub OAuth application is needed.
The launcher allocates a free port starting at 4280 and records the URL in
`code/web/.env.node.local`. It warms public pages before allowing normal requests.
Restarting rebuilds the memory cache before the site becomes ready again.

Open `/write` and enter the fixed example password **`quiescent-demo`**. The gate
uses a signed, HTTP-only, SameSite cookie, marked Secure on HTTPS. Its signing key
is derived from the server's repository token with an application-specific prefix;
rotating that token also invalidates cookies. There are no accounts, registration,
auth database, or Better Auth dependency. This deliberately public demo password
is example access control, not a production authentication policy.

Photos persist under `code/web/.writing-media` by default. Set
`WRITING_MEDIA_DIRECTORY` to a persistent mounted directory for containers.
The file adapter uses the same upload validation and content-addressed finalization
as the R2 adapter. Preserve that directory across restarts.

For phone access over Tailscale on ncrmro-workstation:

```sh
HOST=100.64.0.3 devenv shell -- bun run start:node
```

Open the recorded port using `http://100.64.0.3:4280/write`. Use the same hostname
for startup warming and browsing to benefit from the same origin's cache entries.
Configure `HOST`/`PORT` for deployment. Put HTTPS in front of the server for public use.
Astro's memory cache is per process; this example's self-hosted happy path is one
Node process. Multiple replicas require a shared Astro cache provider.

## Cloudflare example

The hosted test is `https://quiescent-writing-test.ncrmro.workers.dev` and uses
`ncrmro/quiescent-writing-demo`. Configure bindings in
`code/web/wrangler.writing-test.jsonc` and set `SERVICE_TOKEN` through Wrangler's
secret store. Then deploy:

```sh
devenv shell -- bun run deploy:writing
```

The app uses Astro's official `cacheCloudflare()` provider, Cloudflare Workers
Cache, and the R2 bucket `quiescent-writing-demo-images`. `WRITING_SELF` points to
the same Worker so warming requests invoke its cached fetch handler; a Worker
fetching its own public URL normally bypasses that handler. The deployment script
builds, deploys the generated `dist/server/wrangler.json`, and warms public pages.

There are no D1 or KV bindings in the writing example. The previously used D1
instance is left unbound for rollback; the app neither reads nor writes it.
Astro sessions are disabled because the example cookie does not require them.
The Cloudflare cache provider is currently experimental in Astro.

Photos upload through the Worker into its private R2 binding. Optional direct
browser-to-R2 uploads use `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, and
`R2_SECRET_ACCESS_KEY`, with exact-origin bucket CORS. Keep the bucket private.
Git LFS is a deferred media adapter, not implemented by this example.

For a local Worker, set the PAT in `code/web/.dev.vars` and run
`devenv shell -- bun run dev:writing`. The launcher builds the local configuration,
allocates a port, and records it in `code/web/.env.local`. The same demo password
applies. Cloudflare's deployed cache behavior is validated on the hosted Worker;
Astro development mode intentionally does not cache pages.

## Library integration

The main pieces are existing workspace packages:

- `@quiescent/git`: refs, commit conflict checks, comparisons, and merges.
- `@quiescent/server`: framework-independent publishing service, HTTP handler, and media adapters.
- `@quiescent/astro`: Astro route helpers, cache policies, invalidation, and warming.
  This is a publishable workspace package; its first npm release is deferred
  until the writing workflow is validated.
- `@quiescent/editor`: formatted editor, serialized saves, recovery, photos,
  publication and deletion controls, and incremental author-list updates.

The example's writing API delegates to the library:

```ts
import {astroWriting} from "@quiescent/astro";

export const ALL = context => astroWriting({
  service,
  media,
  authorize,
  origin: context.url.origin,
  fetch: warmFetch, // normal fetch on Node; self-service binding on Cloudflare
}).api(context);
```

Reader routes call `prepareReader(Astro, service, postId)` before rendering.
This applies `cachePublication()` and sets headers before HTML streaming begins.
Omitting the ID applies the public-index policy. `readerPath(post)` supplies the canonical
article URL. The current integration uses `/`, `/read`, `/read/<id>/<slug>`, and
`/api/writing`; hosts using it should mount those routes.

Public HTML is cached for 24 hours and tagged for targeted invalidation. Private
editor pages, APIs, password endpoints, and Edit-link server islands are no-store.
The same cached article HTML serves signed-in and anonymous readers; only the
small Edit-link island checks the cookie. Cache hits bypass page rendering and
GitHub reads. `X-Quiescent-Rendered` identifies a render for acceptance checks.

| Operation | Behavior |
| --- | --- |
| Create/save | Commit the draft branch and update the editor's private list from the response; no public invalidation |
| Publish/revise | Merge the captured draft into `main`, purge the article/media and index tags, and warm affected HTML before responding |
| Delete | Commit a Git tombstone, remove the editor entry, purge affected pages/media, warm indexes and the removed article's 404 |
| Explicit refresh | Rebuild the public page cache from `main`; never scan draft branches |

Opening an author dashboard may discover active branches. Subsequent editor
mutations update its list directly, avoiding repeated branch scans. Public pages
only read `main`. GitHub remains authoritative for every mutation, including
stale-tab checks. Deleted IDs cannot be revived by a retained draft branch.
Deletion preserves Git history and does not immediately garbage-collect media.

Quiescent awaits invalidation and warming after the Git operation, then confirms
cache hits where the native provider exposes cache status, with bounded retries
for delayed fills. If warming
fails after Git succeeds, the API returns the committed result with `cacheWarning`
so clients can distinguish a saved mutation from a cache failure. Use the explicit
refresh command to recover. Out-of-band GitHub edits also require refresh (or wait
for the TTL); there is no hidden hourly branch scan or webhook infrastructure:

```sh
BASE_URL=https://quiescent-writing-test.ncrmro.workers.dev \
  devenv shell -- node scripts/writing-warm.mjs
```

Images must belong to their post. JPEG, PNG, and WebP are limited to 10 MB.
Staging uploads are validated and sealed under a SHA-256 content address. Public
media checks the current published references; publishing and deleting invalidate
that post's cached media. Image transcoding, EXIF removal, orphan cleanup, and
multi-author permissions remain outside this prototype.

## Validation

```sh
devenv shell -- bun run test
devenv shell -- bun run typecheck
devenv shell -- bun run build:writing
devenv shell -- bun run build:node
# Run against an already-started build. This writes uniquely titled test posts.
BASE_URL=http://100.64.0.3:4280 QUIESCENT_LIVE_TEST=1 \
WRITING_TEST_PASSWORD=quiescent-demo devenv shell -- \
  node code/web/node_modules/@playwright/test/cli.js test \
  --config code/web/playwright.writing.config.ts
```

The same suite runs on Cloudflare and Node. It checks formatted writing, photos,
private revisions, stale tabs, password cookies, slug routes, first-request cache
hits after publishing, stable cached HTML, deletion, and draft privacy. The Node
acceptance repository is the separate private `ncrmro/quiescent-writing-node-demo`
so filesystem-backed images are not mixed with the Cloudflare demo's R2 objects.

Validation on 2026-09-30: 96 package tests pass, workspace type checks pass,
and Node and Cloudflare production builds pass. Frozen dependency installation
succeeds without changes. Coverage includes arbitrary non-blog schemas, atomic
metadata/body saves, invalid metadata leaving Git unchanged, legacy JSON migration,
Markdown rich-text round trips, and collection-specific Astro cache warming.

The live metadata journey passed on both Node and the deployed Cloudflare Worker: title/slug/tags/header image/body save and
reopen, invalid-slug rejection, private images, publication, private revisions,
and first-request HTML cache hits after publish and revision. Cloudflare used the existing private R2 bucket for the header-image upload.
The stored Markdown was read directly from its GitHub commit. The phone-width editor has no horizontal
overflow. Node and the deployed Cloudflare Worker both passed the focused
publication/deletion cache test, including cached 404s and stale-draft protection.
This resolves the previously pending cache-fill confirmation check.

Cloudflare deployment: `af815298-146d-4fad-b330-f498c80812a0`.
The Node app runs on ncrmro-workstation at the URL recorded in
`code/web/.env.node.local`; the hosted app uses its existing R2 bucket. No npm
packages were published. MDX remains deferred.
