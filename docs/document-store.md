# Document store

Quiescent stores schema-validated YAML front matter and a Markdown body in Git.
Metadata and body are saved in one commit. The canonical API input is
`{ frontmatter, body }`; records also expose managed `id`, `createdAt`, and optional
`publishedAt`. `createdAt` is a required calendar-date string (`YYYY-MM-DD`), assigned
from UTC at creation and retained thereafter. Publication time remains a timestamp.

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
the Markdown and referenced LFS pointers in the same commit.

```
recipes/2026-10-01-summer-salad/index.md
recipes/2026-10-01-summer-salad/salad-<digest>.png
recipes/2026-10-01-summer-salad/.gitattributes
recipes/.quiescent/<uuid>.json
```

Draft branches are `quiescent/<collection>/<uuid>/<editing-cycle-uuid>`.
Public reads use `main`; private lists discover the collection's draft branches.
Publishing merges directly into main. Mutations require the captured branch and
`expectedHeadSha`; conflicts preserve the caller's draft. Deletes record a tombstone
so retained branches cannot resurrect a deleted document.

## Media and HTTP

`createDocumentService` adds `media`, `lfs`, and a `references(document)` callback to
the store options. It commits LFS pointers and verifies/hydrates delivery copies.
Only bare filenames appear in Markdown or image metadata. R2 and filesystem storage
serve originals; Git LFS remains the durable source. The current media adapters
support PNG, JPEG, and WebP up to 10 MB.

`createDocumentHandler({ store, apiBase, authorize, media, readMedia })` mounts one
collection. Its routes relative to `apiBase` are:

| Route | Behavior |
| --- | --- |
| `/` | GET list, POST create with `{frontmatter, body}` |
| `/schema` | GET JSON Schema |
| `/<id>` | GET draft, PUT atomic save, DELETE document |
| `/<id>/publish` | POST publish captured revision |
| `/<id>/published` | GET published record behind the handler's authorization |
| `/<id>/uploads` | POST upload ticket |
| `/<id>/uploads/<asset>` | PUT local upload |
| `/<id>/uploads/<asset>/confirm` | POST finalize with original filename |
| `/<id>/media/<filename>` | GET authorized draft/staged preview |

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
refresh, not the edit. The default TTL is 24 hours. Direct Git edits require an
explicit cache refresh; arbitrary new files are not automatically registered.
Keep managed UUID/date fields and update the locator if moving folders manually.

`mountDocumentApp` accepts initial document values, display labels, URL callbacks,
image-field names, and custom metadata controls. Its default form supports scalar
fields and string lists; structured arrays/objects use JSON input. Unrendered fields
survive saves. Metadata and body share one save and one recovery record. Markdown
that cannot round-trip through the visual editor opens in a Markdown text area.

Optional `DocumentBody` and `DocumentImage` exports are under
`@quiescent/astro/components/*`. Override `imageComponent` on the body renderer or
use the document/media APIs directly. The metadata map is optional: `resolveImage(filename)`
can provide URLs directly to a custom renderer without reading image dimensions. `DocumentImage` wraps Astro Image with
configurable width, responsive widths, sizes, format, and quality. `documentImages`
accepts filenames and a media reader, without knowledge of a blog schema.
Runtime transforms belong to the host. HTML warms on publication; transformed
image variants are generated on demand and cached with document publication tags.

Old post APIs, JSON document imports, and URL-valued media references are removed.
There is no migration or compatibility layer.
