# Document writing example

The example hosts posts and recipes with one document service, schema-driven editor,
and Astro cache integration. Posts appear on `/`; recipes appear on `/recipes`.
List documents at `/write`, start at `/posts/new` or `/recipes/new`, and edit at
`/<collection>/<uuid>/edit`.
Reader URLs omit dates; post folders in Git include the date-only creation value.

Sign in using `quiescent-demo`. This fixed password and signed cookie are example
application code, not a reusable authentication system. Configure a server-side
GitHub repository token and R2 or filesystem media storage. There is no auth database.

See [document contracts and extension points](document-store.md),
[Node hosting](deploy-container.md), and [Cloudflare hosting](deploy-cloudflare.md).
The independent wiki package is not involved in the writing workflow.

## Validation

```sh
devenv shell -- bun run check
devenv shell -- bun run test:e2e
devenv shell -- bun run test:packages
devenv shell -- bun run build:node
```

The isolated browser suite edits both schemas without credentials. Live acceptance
uses explicitly configured disposable GitHub repositories. It creates, uploads,
saves, publishes, renames, and deletes a document in each collection, checks public
visibility and warmed HTML, and verifies actual optimized image responses.

```sh
BASE_URL=http://100.64.0.3:4280 QUIESCENT_LIVE_TEST=1 \
EXAMPLE_IMAGE=/absolute/path/to/example.png \
devenv shell -- node code/web/node_modules/@playwright/test/cli.js test \
  --config code/web/playwright.writing.config.ts
```

Live tests retain Git history and LFS originals. They do not delete unrelated files
or media. Network traces are disabled because upload URLs contain credentials.

## Rendering choices

The blog uses optional Quiescent Astro components backed by Astro Image. The recipe
body overrides image rendering with a plain image component. Both resolve bare
filenames through the same Git LFS and delivery adapters. The example's header
images use responsive optimization on both runtimes: Sharp on Node and the Images
binding on Cloudflare.

Public HTML is cached for 24 hours and warmed on publication, deletion, startup,
and deployment. Draft saves do not change public content. Optimized image variants
are generated on first request, then cached. Direct Git edits require cache refresh.
Unsupported visual-editor Markdown remains editable as source and displays as
escaped source in this deliberately small example renderer.

## Release readiness

No npm publication is required for development. Tarball tests install all five
libraries outside the workspace, check types and runtime imports, and build an Astro
page using the shipped components. CI also checks generated binding freshness,
complexity, source size, and both runtime builds.

A future release PR must include compatible package dependency versions and its
updated lockfile. The publishing job uses a frozen install, validates the packages,
and publishes in dependency order. Newly introduced packages need registry trusted
publisher setup before automated publication. This refactor does not perform that setup.

The former post-specific service and HTTP APIs, JSON document imports, and old
URL-valued image references are removed. Example content can be reset; there is no
migration layer.

For new deployment credentials, use the minimum GitHub repository permissions needed
for Contents operations and Git LFS. Keep these credentials server-side. Existing
examples are intended for disposable test repositories, not shared production content.

## Acceptance evidence — 2026-10-01

The refactor passed 80 unit tests, strict type checks, Biome complexity and file-size
checks, two isolated editor browser tests, binding freshness, both runtime builds,
and an external consumer build using installed package tarballs. Live post and recipe
create/upload/save/publish/rename/delete tests passed on Node and Cloudflare, including
cache warming, old-route removal, and media visibility. No npm packages were published.

The final mobile browser smoke verified both indexes, readers, optimized WebP headers,
and recipe images using the plain renderer on both deployments:

- [Workstation example](http://100.64.0.3:4280/) over Tailscale.
- [Cloudflare post](https://quiescent-writing-test.ncrmro.workers.dev/posts/a-slow-morning-in-the-garden).
- [Cloudflare recipe](https://quiescent-writing-test.ncrmro.workers.dev/recipes/a-simple-garden-salad).

Cloudflare Worker version: `0f1f886a-6553-456c-ab35-8a1a13a3ed62`. Both demo
repositories contain the post at
`posts/2026-10-01-a-slow-morning-in-the-garden/index.md`, the recipe at
`recipes/a-simple-garden-salad/index.md`, and adjacent Git LFS image pointers.
Their front matter records `createdAt: 2026-10-01`; browser slugs contain no date.

## Browser-local drafts

New post and New recipe allocate a UUID and store metadata and body in localStorage.
Typing and navigating between these drafts do not write to GitHub. Reload the new page to resume this tab’s draft, or open a Local entry from `/write`. Save now (or Publish) creates the first Git
branch with the same UUID; subsequent edits autosave normally. Local entries are
removed after a successful first save. Deleting a local draft makes no Git request.
Images require the first save before uploading. Unsaved local drafts are specific
to this browser and origin; they are not available on another device.

Validated with 81 unit tests, strict type/lint checks, and post/recipe browser tests
covering reload, first save, and local deletion. Live workstation and Cloudflare
checks confirmed zero create requests before Save now and the same UUID after
saving. Cloudflare version: `811ad2a5-49cf-42f0-8985-0a8ba8130601`.

## Editor routes

`/write` is a document list. New links navigate to `/posts/new` or `/recipes/new`;
edit links use `/<collection>/<uuid>/edit`. One Astro rest route dispatches to the
shared editor component or public slug reader. Editor routes do not scan branches
to resolve a slug. New pages resume their tab's local draft after reload. The first
save changes the URL with `history.replaceState`; the editor DOM and layout remain
in place. Public reader URLs continue to use slugs. The slug `new` is reserved.

Route acceptance passed on desktop and a 390px mobile viewport: editor bounds are
identical before and after first save and the original editor element stays mounted.
All 81 unit tests and strict checks pass. Live Node and Cloudflare checks verified
local reload, UUID-preserving first save, edit-URL reload, and existing public readers
and image rendering. Worker version: `a1f6cfba-0607-4138-aaf8-4a7969214e07`.
