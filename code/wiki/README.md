# @quiescent/wiki

Astro-focused wiki toolkit over a directory of markdown notes: Obsidian-style
`[[wikilinks]]`, hierarchical tags, client-side search, and a force-directed
note graph. Everything is computed at build time and baked into the bundle, so
the same code runs on Cloudflare Workers (no runtime filesystem) and Node.

Pairs with `@quiescent/server` + `@quiescent/editor` for in-browser editing
that persists through a git forge; see the repo root README and `docs/`.

## Wiring

```js
// astro.config.mjs
import { quiescentWiki } from "@quiescent/wiki";

export default defineConfig({
  integrations: [quiescentWiki({ dir: fileURLToPath(new URL("../wiki", import.meta.url)) })],
});
```

The integration:

- registers a remark plugin rewriting `[[Target]]` / `[[Target|alias]]` into
  links (`.wikilink`, dead links become `.wikilink--dead` spans and warn);
- exposes **`virtual:quiescent-wiki`** with build-time data:

```ts
/// <reference types="@quiescent/wiki/virtual" />  // in env.d.ts
import { searchIndex, graph, tags, notes } from "virtual:quiescent-wiki";
```

| Export | What it is |
| --- | --- |
| `searchIndex` | Serialized MiniSearch index (title/tags/headings/body) |
| `graph` | `{ nodes, edges }` — notes + tags, wikilink + membership edges |
| `tags` | `Record<tag, {url, title}[]>` for tag pages |
| `notes` | Note metadata (frontmatter, headings, excerpt — no body text) |

Serve `searchIndex`/`graph` from auth-guarded API routes (`Cache-Control:
private`) and consume them with the client module:

```ts
import { fetchWikiSearch, mountWikiGraph } from "@quiescent/wiki/client";

const search = await fetchWikiSearch("/api/wiki/search-index");
search.search("hydroponics");

mountWikiGraph(document.getElementById("graph")!, graph, { showTags: true });
```

Copyable route + page examples live in `code/web/src/pages/wiki-demo/` and
`code/web/src/pages/api/wiki/` in this repo.

## Node API

All build-time (uses `node:fs`) — never import from client islands:

- `scanNotes({ dir })` → parsed notes (frontmatter, tags, headings, excerpt,
  stripped text, wikilink targets)
- `buildWikiIndex({ dir })` → name/title → URL index with ambiguity tracking
- `resolveWikiTarget(target, index)` → URL or null (dead/ambiguous)
- `buildWikiGraph(index, { includeTags })`, `buildTagIndex(index)`
- `buildSearchIndex(index)` → serialized MiniSearch (`SEARCH_OPTIONS` shared
  with the client loader)
- `validateWikiLinks({ dir })` / `reportWikiLinks({ dir })` — dead-link CI
  gate:

```ts
// scripts/check-wiki-links.ts
import { reportWikiLinks } from "@quiescent/wiki";
process.exit(reportWikiLinks({ dir: new URL("../../wiki", import.meta.url).pathname }));
```

Note URLs are the wiki-relative path with each segment github-sluggered —
exactly the `id` Astro's glob content loader computes, so wikilink hrefs line
up with `getCollection`-driven routes.

## Content conventions

See `docs/conventions.md` in the repo root: frontmatter (`title`, `type`,
`status`, `tags`, `created`, `updated`), hierarchical `namespace/value` tags,
one note per file, sources as `sources/<date>-<slug>/source.md` resolving by
frontmatter title.
