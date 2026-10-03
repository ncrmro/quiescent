# Document store

Quiescent stores schema-validated YAML front matter and a Markdown body in Git.
Metadata and body are saved in one commit. The canonical API input is
`{ frontmatter, body }`; records also expose managed `id`, `createdAt`, and optional
`publishedAt`. `createdAt` is a required calendar-date string (`YYYY-MM-DD`), assigned
from UTC at creation and retained thereafter. Publication time remains a timestamp.

## Declarative configuration

Start with `quiescent.config.json`. Each collection contains its own inline JSON
Schema; the same schema validates saves and supplies the example editor fields.
The complete example is [`code/web/quiescent.config.json`](../code/web/quiescent.config.json).

```json
{
  "$schema": "./node_modules/@quiescent/server/dist/config.schema.json",
  "repository": {
    "provider": "github",
    "owner": "writer",
    "name": "content",
    "publishedBranch": "main"
  },
  "collections": {
    "posts": {
      "directory": "content/posts",
      "filename": "{createdAt}-{slug}",
      "draftBranch": "quiescent/{collection}/{id}/{cycle}",
      "schema": {
        "type": "object",
        "required": ["title", "slug"],
        "properties": {
          "title": { "type": "string" },
          "slug": { "type": "string", "pattern": "^[a-z0-9]+(?:-[a-z0-9]+)*$" }
        },
        "additionalProperties": false
      }
    }
  }
}
```

```ts
import configuration from './quiescent.config.json';
import { defineDocumentConfig, configuredCollection, createDocumentStore } from '@quiescent/server/documents';

const config = defineDocumentConfig(configuration);
const documents = createDocumentStore({
  ...configuredCollection(config, 'posts'),
  forge,
  author,
});
```

`defineDocumentConfig` validates configuration keys, directories and naming templates.
The application supplies the authenticated forge using `config.repository`; tokens
never belong in this file. JSON imports bundle the data into Node and Worker builds
without runtime filesystem access. The Astro example also validates configuration
in `astro.config.mjs`, so invalid configuration fails the build.

- Collection identity is separate from its directory. Nested repository-relative
  directories such as `content/posts` are supported; overlapping collection directories
  and traversal paths are rejected. The default directory is the collection name.
- `filename` names the document folder, with `index.md` inside. Its default is `{id}`.
  Templates accept `{id}`, `{createdAt}` (YYYY-MM-DD), and string metadata fields such
  as `{slug}`. Missing values, unsafe rendered basenames and collisions reject saves.
- `draftBranch` defaults to `quiescent/{collection}/{id}/{cycle}`. Custom templates
  must contain `{id}` and `{cycle}` exactly once; `{collection}` is also available.
  Branches use immutable identity, so changing a slug does not change an active branch.
- `publishedBranch` defaults to `main`. Browser routes remain an application choice.
- Schemas are inline JSON Schema; local `$defs`/`$ref` work within each schema. Loading
  external schema files or URLs is not part of this configuration API.
- Code can override the resolved options, including the existing `filename(document)`
  callback. Media adapters, asset-reference extraction and lifecycle hooks remain code.

The example retains `posts/` and `recipes/` so existing content stays readable. Its
repository owner/name can be overridden by `WRITING_REPO_OWNER`/`WRITING_REPO_NAME`
for isolated previews; otherwise the JSON values apply. Post schemas, recipe schemas,
folder naming and branch naming all come from JSON. Slug derivation, initial empty
editor values, rendering and publication rules remain example UI/application code.

Changing a collection directory or draft branch template on an existing repository
requires migrating existing paths/branches; it does not automatically relocate them.
Changing a filename template moves each document folder on its next save.

## Programmatic configuration

```ts
import { createDocumentStore } from '@quiescent/server/documents';

const documents = createDocumentStore({
  forge,
  author: { name: 'Writer', email: 'writer@example.com' },
  collection: 'recipes',
  schema: recipeSchema,
  filename: (document) => `${document.createdAt}-${document.frontmatter.slug}`,
});
const draft = await documents.createDocument({
  frontmatter: { slug: 'summer-salad', ingredients: ['tomato', 'salt'] },
  body: 'Mix gently.',
});
```

`filename` is a synchronous function returning one safe storage basename. It names
the document folder, not the browser URL or Markdown extension. The default is the
UUID. The callback receives the assigned UUID and creation date. Invalid names and
collisions fail instead of overwriting another document. Saving a changed name moves
the Markdown and all existing supported LFS pointers in the same commit, including
originals no longer referenced by the body.

```
recipes/2026-10-01-summer-salad/index.md
recipes/2026-10-01-summer-salad/salad-<digest>.png
recipes/2026-10-01-summer-salad/.gitattributes
recipes/.quiescent/<uuid>.json
```

Draft branches are `quiescent/<collection>/<uuid>/<editing-cycle-uuid>`.
Public reads use the configured publication branch (`main` by default); private
lists discover the collection's draft branches. Publishing merges directly into
the configured publication branch. Mutations require the captured branch and
`expectedHeadSha`; conflicts preserve the caller's draft. Deletes record a tombstone
so retained branches cannot resurrect a deleted document.

## Media and HTTP

`createDocumentService` adds `media`, `lfs`, and a `references(document)` callback to
the store options. It commits LFS pointers and verifies/hydrates delivery copies.
Only bare filenames appear in Markdown or image metadata. R2 and filesystem storage
serve originals; Git LFS remains the durable source. The current media adapters
support PNG, JPEG, WebP, and GIF. New browser uploads are limited to 10 MiB;
stored originals can be restored up to 32 MiB. Configure the LFS client's `maxSize`
accordingly when importing larger originals. GIF delivery preserves animation.

`createDocumentHandler({ store, apiBase, authorize, media, readMedia })` mounts one
collection. Its routes relative to `apiBase` are:

| Route | Behavior |
| --- | --- |
| `/` | GET list, POST create with `{frontmatter, body}` |
| `/schema` | GET JSON Schema |
| `/listing` | GET documents with cache freshness metadata |
| `/listing/refresh` | POST rebuild the private listing from Git |
| `/<id>` | GET existing draft or published document without creating a branch, PUT atomic save, DELETE document |
| `/<id>/publish` | POST publish captured revision |
| `/<id>/published` | GET published record behind the handler's authorization |
| `/<id>/uploads` | POST upload ticket |
| `/<id>/uploads/<asset>` | PUT local upload |
| `/<id>/uploads/<asset>/confirm` | POST finalize with original filename |
| `/<id>/media/<filename>` | GET authorized draft/staged preview |

Opening the editor and reading draft media do not create a branch. Saving a
published document starts its next editing cycle after checking the captured
revision; opening a new document remains local until its first save.

The host exposes public reads separately. `service.readMedia(id, filename)` checks
current published references; pass a draft branch only behind authorization.
Tokens remain server-side. The example uses a fixed password, not a library auth system.

## Astro and editor

`astroDocuments` joins the handler to full-page caching. Supply `collection`,
`origin`, `documentPath`, `indexPaths`, and optional `affectedPaths(previous, next)`.
Storage names and browser paths are independent: a date-prefixed folder can appear
at `/posts/summer-salad`. Use `pages.set(cache, id)` while rendering. Publication
invalidates and warms affected pages; renamed URLs become cached 404 responses.
An authorized POST to `<apiBase>/cache/refresh` refreshes the collection.

A successful mutation can return `cacheWarning` when cache work fails. Retry cache
refresh, not the edit. The example uses a one-hour document-cache TTL and serves
stale data while a read-triggered refresh runs. Direct Git edits appear after
explicit refresh or TTL expiry. HTML lifetime is bounded by document freshness;
arbitrary new files are not automatically registered.
Keep managed UUID/date fields and update the locator if moving folders manually.

`mountDocumentApp` accepts initial document values, display labels, URL callbacks,
image-field names, and custom metadata controls. Its default form supports scalar
fields and string lists; structured arrays/objects use JSON input. Unrendered fields
survive saves. Metadata and body share one save and one recovery record. Markdown
that cannot round-trip through the visual editor opens in a Markdown text area.

Hosts may use `layout(root)` to arrange the mounted controls before a document opens,
`configureToolbar(toolbar)` to arrange command buttons, and `formatStatus(message)`
to customize status wording. Layout and toolbar hooks can return cleanup functions.
Keep mounted controls inside `root` and retain their `data-*` attributes and handlers;
metadata fields have `data-metadata-field` containers, and toolbar buttons have
`data-command` identifiers. Presentation changes still use the same document state,
validation, recovery, and atomic save. Blog-specific sheets and labels belong to the
example app, rather than the document store.

Optional `DocumentBody` and `DocumentImage` exports are under
`@quiescent/astro/components/*`. Override `imageComponent` on the body renderer or
use the document/media APIs directly. The metadata map is optional: `resolveImage(filename)`
can provide URLs directly to a custom renderer without reading image dimensions. `DocumentImage` wraps Astro Image with
configurable width, responsive widths, sizes, format, and quality; GIFs use their
original URL instead of a static responsive transform. `documentImages`
accepts filenames and a media reader, without knowledge of a blog schema.
Runtime transforms belong to the host. HTML warms on publication; transformed
image variants are generated on demand and cached with document publication tags.

Old post APIs, JSON document imports, and URL-valued media references are removed.
There is no migration or compatibility layer.


### Editing API

Both the low-level store and application service expose `openDocument` for read-only
selection and `saveDocument` for an atomic metadata/body save. A published selection
has `branch: null`; its first save creates an editing branch with revision checks.
Concurrent first saves cannot overwrite the winner, and interrupted initialization
can be retried with the same selection. Opening a document never creates a branch.
