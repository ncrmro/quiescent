# Schema-driven Markdown documents

Quiescent stores a collection of documents in GitHub. Supply a JSON Schema for
metadata and save `{frontmatter, body}` in one operation. The schema describes
metadata, while `body` is Markdown text. There is no separate metadata save.
MDX execution is not implemented.

```ts
import {createDocumentStore} from '@quiescent/server/documents';

const recipes = createDocumentStore({
  forge, // a PublishingForge, e.g. requirePublishingForge(createForge(...))
  author: {name: 'Example writer', email: 'writer@example.com'},
  collection: 'recipes',
  schema: {
    type: 'object',
    required: ['servings', 'ingredients'],
    additionalProperties: false,
    properties: {
      servings: {type: 'integer', minimum: 1},
      ingredients: {type: 'array', items: {type: 'string'}, minItems: 1},
    },
  },
});

const draft = await recipes.createDocument({
  frontmatter: {servings: 2, ingredients: ['Peaches', 'Cream']},
  body: '# A summer dessert\n\nServe cold.\n',
});
const saved = await recipes.saveDraft({
  id: draft.document.id,
  branch: draft.branch!,
  expectedHeadSha: draft.headSha,
  document: {
    frontmatter: {servings: 4, ingredients: ['Peaches', 'Cream']},
    body: '# A summer dessert\n\nShare with friends.\n',
  },
});
await recipes.publish({
  id: saved.document.id,
  branch: saved.branch!,
  expectedHeadSha: saved.headSha,
});
```

This writes `recipes/<id>/index.md`:

```md
---
id: 11111111-1111-4111-8111-111111111111
createdAt: 2026-09-30T09:00:00.000Z
servings: 4
ingredients:
  - Peaches
  - Cream
---
# A summer dessert

Share with friends.
```

Metadata is validated on create, save, read, and publish using JSON Schema
2020-12 by default. Invalid metadata returns a `DocumentError` with field errors
and leaves the saved revision unchanged. The codec preserves Markdown body text
verbatim. YAML is data; neither YAML nor the body executes code.

The store owns `id` and `createdAt` in the stored front matter. They are returned
as document fields, outside your schema's `frontmatter`; do not supply them as
metadata fields. Both remain stable when a slug changes. The default folder is
`<collection>/<uuid>/index.md`. Configure `directoryTemplate` with `{id}`, `{slug}`,
and `{createdAt:YYYY-MM-DD}` to choose a readable folder. Templates produce one
safe directory segment, not arbitrary paths. The posts preset uses
`posts/YYYY-MM-DD-slug/index.md`, with a UUID slug fallback.

A stable `<collection>/.quiescent/<uuid>.json` record locates the current folder
and holds publication/retry/deletion state. Saving a changed slug moves the
Markdown and referenced image pointers in the same commit. Colliding folders are
rejected. UUIDs also identify branches: `quiescent/<collection>/<uuid>/<cycle-uuid>`.

Markdown, workflow state, and image pointers are written in **one Git commit**,
guarded by the expected branch revision. Collections use a single directory name
(letters, digits, underscores, hyphens).

`getDraft`, `saveDraft`, `publish`, `deleteDocument`, `getPublished`,
`listPublished`, and `listDocuments` all share the same lifecycle. Publication
merges only that document's files into `main`, without a pull request. Public
reads only inspect `main`; author listings discover draft branches. Deletion
retains Git history and prevents old draft branches from resurrecting a document.
A manually added Markdown file without publication state is not public until
published through the store. External Git changes require cache refresh.

## Astro integration

Astro-specific helpers live in `@quiescent/astro`. The document store and private
HTTP handler live in `@quiescent/server` and do not import Astro or Cloudflare.

```ts
import {astroDocuments} from '@quiescent/astro';

const app = astroDocuments({
  store: recipes,
  collection: 'recipes',
  authorize,
  origin: 'https://example.com',
  apiBase: '/api/recipes',
  indexPaths: ['/recipes'],
  documentPath: document => `/recipes/${document.id}`,
  maxAge: 86400,
  fetch: warmFetch,
});
// In a catch-all Astro API route:
export const ALL = context => app.api(context);
// In public page frontmatter, before rendering:
// app.set(Astro.cache, documentId);  // omit the ID for the index
// At startup or for an explicit refresh:
// await app.refresh(cache, (await recipes.listPublished()).map(d => d.document));
```

Private CRUD endpoints are collection root `GET`/`POST`, `GET /schema`,
`GET`/`PUT`/`DELETE /<id>`, and `POST /<id>/publish`. Create accepts
`{frontmatter, body}`. Update accepts `{branch, expectedHeadSha, document:
{frontmatter, body}}`. Publish accepts `{branch, expectedHeadSha}`. Delete accepts
`{branch, expectedHeadSha}` with a nullable branch for published documents.
All endpoints require authorization; mutations require a matching Origin header.
Public rendering uses `store.getPublished()` / `store.listPublished()` directly.

Astro caches the whole public page. Publish/delete invalidates affected tags and
warms configured routes before returning. Draft saves update the editor's model
from the response; they do not change public pages. A cache failure after a
successful Git operation returns `cacheWarning`, preserving the successful result.
The host chooses Astro's cache provider: memory for a single Node process or the
Cloudflare adapter's provider. Cloudflare warming uses the self-service binding.

## Posts are the reference example

`createPublishingService()` is a thin rich-text adapter over this store using
`postSchema`. The example's metadata fields come from that schema:

- **Title** and **description**.
- **Slug**, editable, with a generated default when saving a titled draft.
- **Tags**, entered as a comma-separated list and saved as a YAML array.
- **Header image**, uploaded with the same media adapter as body images.

The body editor converts its formatted content to Markdown on save and loads it
back on reopen. It supports the existing formatting toolbar, links, and images;
it does not promise arbitrary Markdown syntax can round-trip through rich text.
The general store itself retains arbitrary Markdown body text unchanged.

`@quiescent/editor/metadata` exports the small metadata-form helper for flat
fields. Full JSON Schema validation stays on the server; hosts can supply custom
controls for more complex schemas.

The existing editor performs one save of all fields and body, including autosave
and Ctrl/Cmd+S. Browser recovery includes metadata. Invalid fields remain visible
for correction; the previous Git revision is preserved. Header images remain
private until publication, render in the article and story list, and participate
in media verification and cache invalidation.

Existing `posts/<id>/post.json` files remain readable. Their next edit or
publication atomically writes `index.md` plus internal state and removes the old
JSON file on that draft branch. The published version changes only on Publish.
New posts are Markdown immediately; no bulk migration is required.

The packages remain publishable. Development uses workspace dependencies, with
no new npm releases required for validation.

## Document-relative images

Store filenames in both Markdown and metadata:

```md
---
id: 11111111-1111-4111-8111-111111111111
createdAt: 2026-09-30T09:00:00.000Z
title: A slow morning in the garden
slug: a-slow-morning-in-the-garden
tags: [garden]
headerImage: garden-morning-0123456789ab.png
---
![Tomatoes in the morning sun](garden-morning-0123456789ab.png)
```

Uploads retain a readable basename with a short content hash to avoid accidental
replacement. The image's Git LFS pointer and `.gitattributes` live beside `index.md`.
A normal Git LFS checkout materializes the actual image beside the Markdown, so
relative links work in local Markdown previews. GitHub stores the durable bytes;
R2 or a filesystem adapter stores reconstructible delivery copies scoped by UUID.
The save awaits LFS upload before committing. A failed upload leaves the previous
Git revision intact. Delivery is warmed during save; missing delivery bytes are
verified and restored from LFS when requested.

The posts service accepts `media` and `lfs` adapters. General collections can use
`createDocumentMedia({forge, delivery, lfs, references})` as their store's `assets`
option; `references(document)` returns the image filenames from their schema/body.
Hosts use `documentMediaUrl(document.id, filename)` for rendered URLs. The example
resolves header and body images through its media route, enforcing publication
visibility; private preview URLs include the selected draft branch. Backend URLs
and credentials never enter source Markdown.

Humans can edit an existing `index.md` or replace its adjacent LFS image using
normal Git tooling. Keep the UUID and creation date intact, push LFS objects, and
run the authenticated cache refresh afterward. Moving folders by hand also
requires updating the locator; creating arbitrary files does not automatically
register or publish documents. Old UUID/JSON layouts remain readable and migrate
on save. Previously stored `/media/...` references remain compatible but are not
bulk converted into LFS images.


Astro applications can render these references with
`@quiescent/astro/components/DocumentImage.astro` and `DocumentBody.astro`.
`postImages(draft, service)` supplies their intrinsic image metadata; pass `true`
as its third argument when only index header images are needed. The components
use Astro's `Image` for responsive WebP candidates and loading hints. See the
[example's runtime optimization setup](writing-prototype.md#astro-image-loading)
for publication-aware caching and native Node/Cloudflare transforms.
