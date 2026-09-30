# Quiescent

Quiescent is a GitHub-backed document store. Supply a JSON Schema, edit metadata
and body together, and save Markdown with validated YAML front matter. Drafts
stay private on branches; Publish merges the document into `main` without a pull
request. Posts demonstrate the workflow with title, slug, tags, header image,
and a formatted body editor.

Start with [the writing example](docs/writing-prototype.md) or the
[document API](docs/document-store.md). The same Astro example runs on self-hosted
Node and Cloudflare Workers. It needs a GitHub repository token and image storage;
it has no auth database, D1, KV draft store, or background flush service.

## Packages

| Package | Responsibility |
| --- | --- |
| `@quiescent/git` | Forge HTTP APIs, commits, refs, conflict checks, comparisons, merges |
| `@quiescent/server` | Document validation, Markdown codecs, shared contracts, publication, HTTP handlers, media |
| `@quiescent/astro` | Full-page caching, targeted invalidation, eager warming, thin route helpers |
| `@quiescent/editor` | Schema metadata controls, formatted body editor, atomic saves, recovery, publishing |
| `@quiescent/wiki` | Independent read-only wiki rendering, search, tags, graph; not part of the writing example |
| `@quiescent/web` | Private reference app: presentation, fixed example password, runtime configuration |

Server code does not depend on the editor or Astro. Browser-safe document codecs
are exported from `@quiescent/server/content`; shared document, draft, upload,
and response types come from `@quiescent/server/contracts`. Posts and arbitrary
collections use one store and one CRUD dispatcher.

Public pages read only `main`. Astro caches complete HTML for 24 hours. Publish
and delete invalidate affected pages and warm them before responding. Private
saves update the editor directly. Node startup and Cloudflare deployment warm
pages before the example is ready. See the writing guide for provider limits.

## Development

Use the repository's devenv shell; its Playwright browsers need no download.

```sh
devenv shell -- bun install --frozen-lockfile
devenv shell -- bun run check        # Biome, file size, builds, strict types, unit tests
devenv shell -- bun run test:e2e     # real editor and in-memory forge, no credentials
devenv shell -- bun run build:node
# Set SERVICE_TOKEN through your environment or secret manager first.
WRITING_REPO_OWNER=your-name WRITING_REPO_NAME=your-content-repo \
  devenv shell -- bun run start:node
```

Open the URL in `code/web/.env.node.local` and sign in with `quiescent-demo`.
For a local Worker, copy `code/web/.dev.vars.example` to `.dev.vars` in that same
directory, configure the content repository, then run `bun run dev:writing`.
Deployment details: [Node](docs/deploy-container.md) · [Cloudflare](docs/deploy-cloudflare.md).

TypeScript strict mode, exact optional properties, checked indexed access,
implicit returns, unused declarations, and override checks apply across packages,
Astro pages, tests, and development scripts. Biome rejects explicit `any` and
cognitive complexity above 15 in production (40 in scenario tests). Source files
may not exceed 1,000 lines. CI enforces these checks, generated Worker binding freshness, both runtime builds,
and the browser workflow. Regenerate Worker bindings with `bun run types:cloudflare`
after changing the Cloudflare configuration.

## Removed interfaces and existing content

The old CodeMirror notes editor, OAuth/session APIs, KV draft/flush service,
cron worker, and `/demo` routes have been removed. Consumers of those interfaces
must move to the document API; this is a breaking change for the next release.
Existing JSON posts remain readable through a small import adapter and convert
atomically to Markdown when saved. No existing stories are bulk rewritten.

The standalone [wiki package](code/wiki/README.md) remains available, with its
[content conventions](docs/conventions.md). It does not add a second editing workflow.

## Releases

The five library packages remain publishable. The example is private. Workspace
validation requires no npm releases. Release Please manages versions and real
semver dependency ranges, and the publish workflow uses npm trusted publishing.
Publish only after validating the workflow and reviewing the breaking API changes.
