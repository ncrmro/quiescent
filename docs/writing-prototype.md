# Writing with Quiescent

This prototype writes to a private GitHub content repository from the existing
Astro application running in Cloudflare's local Workers runtime. GitHub is the
source of saved drafts and published posts. The notes vault is not involved.

## Start locally

From the repository root:

```sh
devenv shell -- bun install --frozen-lockfile
devenv shell -- bun run build:writing
# Add SERVICE_TOKEN to code/web/.dev.vars (see writing.dev.vars.example).
devenv shell -- bun run dev:writing
```

Open the `/write` path at `DEV_URL` recorded in `code/web/.env.local`. The
launcher chooses an available loopback port, starting at 4180. `/read` is the
reader-facing site. Changes to package source require rebuilding.

The demonstration repository is `ncrmro/quiescent-writing-demo`, private and
initialized with `main`. Configure another initialized private repo through
`WRITING_REPO_OWNER` and `WRITING_REPO_NAME` in `wrangler.writing.jsonc`.
Use a fine-grained GitHub PAT restricted to that repo with Contents read/write.
`SERVICE_TOKEN` stays in the Worker; no browser token or GitHub OAuth app is
needed. Set the author name/email to the desired commit identity.

The new routes require loopback (or an explicitly allowed origin) plus `WRITING_LOCAL=true` for
author access. The dedicated writing configuration disables the legacy editor
routes and has no cron flush. **Do not deploy this local configuration.** A
hosted application must supply real author authorization to the reusable handler.
The server rejects cross-origin mutations. This is a single-author prototype,
not a multi-user permission system.

For a temporary external secrets file, set `WRITING_SECRETS_FILE` to its path.
Do not commit, print, or put credentials in CLI `--var` arguments.

## Photos

By default, the example uses Wrangler's persistent local R2 emulation. Uploads
pass through the local Worker; this exercises storage and publication privacy,
but does **not** prove browser-to-R2 networking or CORS.

For real direct browser uploads, provision a **private** R2 test bucket and set:

```dotenv
R2_ACCOUNT_ID=your-account-id
R2_ACCESS_KEY_ID=your-bucket-scoped-access-key
R2_SECRET_ACCESS_KEY=your-bucket-scoped-secret
```

Set `WRITING_R2_BUCKET` in the writing config to the bucket name. Credentials
must allow object reads/writes for that bucket. All three credentials are required;
partial remote configuration should be treated as a setup error. Do not enable
public bucket access. Configure bucket CORS with your exact local `DEV_URL`:

```json
[{
  "AllowedOrigins": ["http://127.0.0.1:4180"],
  "AllowedMethods": ["PUT"],
  "AllowedHeaders": ["Content-Type"],
  "MaxAgeSeconds": 300
}]
```

The Worker signs a five-minute PUT URL for a random staging object. On upload
confirmation it validates type, size, and file signature, then seals the bytes
under a SHA-256 content address. Reusing a staging URL cannot overwrite a
published image. Posts contain references, never signed URLs or binary blobs.
The Worker serves public images only if the published post references them.
Author-only media routes also support newly confirmed images before autosave.

JPEG, PNG, and WebP are limited to 10 MB each. This is basic image validation,
not image transcoding or EXIF removal. Configure R2 lifecycle expiry for the
`uploads/` staging prefix (for example, one day); final `images/` objects must
remain available. Orphan-final-image garbage collection is deferred.

Git LFS is a future storage adapter behind the same `MediaStorage` interface.
It is not implemented or required for this R2 demonstration. Ordinary Git image
blobs are not the fallback.

## Ownership and behavior

- `@quiescent/git`: GitHub refs, commits, comparisons, merges, and conflicts.
  Publishing is an explicit optional forge capability; other forge adapters
  retain their existing behavior and do not claim publishing support.
- `@quiescent/server`: draft/publication lifecycle, media adapters, author-gated
  HTTP operations, and reader helpers. Hosts call these rather than implement Git.
- `@quiescent/editor`: formatted writing, serialized saves, unsaved recovery,
  image controls, document validation/rendering, and the reusable UI controller.
- The example app wires configuration, author access, routes, and styles.

Each post has its own draft branch. Save persists only to that branch; idle and
Ctrl/Cmd+S never publish. Publish waits for saves/uploads and merges a captured
commit into `main` without a PR. Published pages read GitHub directly, with
no-store responses, so content changes do not rebuild/deploy the application.
Drafts and images must never become reader-accessible before this merge.

A published article remains read-only in the editor until **Edit post**. Revisions
stay private until **Publish changes**. Failed/stale saves preserve local writing;
recovered browser writing requires explicit review and save. GitHub errors and
merge conflicts do not trigger force pushes. Completed branches are retained
and excluded from active drafts by ancestry, avoiding deletion races.

## Verify

```sh
devenv shell -- bun run test
devenv shell -- bun run typecheck
devenv shell -- bun run build:writing
# Start the built Worker first. This test writes to the configured test repo.
BASE_URL=http://127.0.0.1:4180 QUIESCENT_LIVE_TEST=1 devenv shell -- \
  node code/web/node_modules/@playwright/test/cli.js test \
  --config code/web/playwright.writing.config.ts
```

Use the actual recorded URL. The live test is opt-in, creates uniquely titled
posts, and does not erase earlier work. Playwright traces are disabled because
network traces would retain signed upload URLs. Nix provides the browsers.
Run the same journey with real R2 credentials to validate direct uploads;
a passing local-emulation run is not real-R2 acceptance.

Manual walkthrough: write about a weekend, upload a photo, save and restart;
reopen it, leave a second draft unfinished, publish only the first, then edit it
and check readers retain the old version until Publish changes. The remaining
product acceptance is the author completing this flow without Git or terminal
interaction after setup.

## Release boundary

All packages are consumed through local workspace dependencies. This work does
not bump versions, publish packages, modify release workflows, deploy a public
Worker, or migrate existing website content. Validate the writing experience
before deciding package releases, hosted authentication, content migration,
scheduling, Git LFS, or media scaling.

## Validation recorded 2026-09-27

- 81 package tests pass; workspace typecheck and the Worker build pass.
- All 10 existing blog/wiki browser tests pass.
- Both opt-in writing browser journeys pass against real GitHub with **local
  R2 emulation**: post/image isolation, formatted text preservation, private
  revisions, failed-upload retry, publishing/upload locking, and stale-tab recovery.
- After stopping and restarting the Worker, the saved draft and published article
  were recovered from GitHub. Local image bytes remained in Wrangler's R2 storage.
- The private test repo contains actual two-parent publication merge commits and
  zero PRs. Example evidence: [publication merge](https://github.com/ncrmro/quiescent-writing-demo/commit/550304edaeeacb703ad8116d080d45986c076162).
- A focused read-only review found concurrency and recovery issues; those were
  corrected and reviewed again. Built JavaScript contains no test credential.

Still unverified: real R2 direct uploads/CORS (bucket credentials are required),
user hands-on acceptance, and hosted authentication/deployment. Git LFS remains
an explicitly deferred adapter. Nothing was published to npm.

## Phone access over Tailscale

Bind only to the workstation's Tailscale IP, with exact allowed origins:

```sh
WRITING_HOST=100.64.0.3 \
WRITING_ALLOWED_ORIGINS=http://ncrmro-workstation:4180,http://ncrmro-workstation.mercury:4180,http://100.64.0.3:4180 \
devenv shell -- bun run dev:writing
```

Stop this checkout's existing writing server before switching its bind address.
Check the allocated port in `.env.local`; update allowed origins if it changes.
Open `http://ncrmro-workstation:4180/write` with Tailscale connected on the phone.
This grants author access to devices allowed to reach that tailnet port; use only
with the private demo repository. HTTP traffic travels inside Tailscale's encrypted
connection. The editor supports browsers without secure-context `randomUUID`.

## Hosted test

The isolated test is deployed at
`https://quiescent-writing-test.ncrmro.workers.dev/write` using
`code/web/wrangler.writing-test.jsonc`. It uses the same private GitHub repository
and a private, real R2 bucket named `quiescent-writing-demo-images`.

The entire test site requires HTTPS Basic authentication with username `writer`
and the separate `WRITING_PASSWORD` Worker secret. `SERVICE_TOKEN` is the
repository-scoped GitHub PAT; it is never the browser login password. Missing
credentials deny access. Local-host exceptions do not apply to hosted test mode.
The test site's published reader pages also require this login.

Deploy changes with:

```sh
devenv shell -- bun run build:writing
devenv shell -- node code/web/node_modules/wrangler/bin/wrangler.js deploy --config code/web/wrangler.writing-test.jsonc
```

Set credentials through `wrangler secret put` or a protected temporary file with
`wrangler secret bulk`; never add them to config or source. Assets exclude the
server bundle, and requests run through the Worker authorization middleware.

Photos upload through the Worker into its R2 binding. This validates real R2
persistence without separate S3 credentials or bucket CORS. Direct signed browser
uploads remain an optional adapter requiring the R2 credentials described above.
The original five referenced local demo images were copied to the test bucket.

For the live browser suite, provide `BASE_URL`, `QUIESCENT_LIVE_TEST=1`, and
`WRITING_TEST_PASSWORD` through the process environment. Tracing remains disabled
to avoid recording credentials or signed upload URLs. No npm publication is needed.
