// Build-time / server-side API. Everything here may touch node:fs — do not
// import from client islands; use "@quiescent/wiki/client" there.

export { type QuiescentWikiOptions, quiescentWiki } from "./astro/integration.ts";
export {
  type DeadLink,
  type LinkReport,
  reportWikiLinks,
  validateWikiLinks,
} from "./check-links.ts";
export {
  buildTagIndex,
  buildWikiGraph,
  buildWikiIndex,
  resolveWikiTarget,
  type WikiGraph,
  type WikiGraphEdge,
  type WikiGraphNode,
  type WikiIndex,
} from "./graph.ts";
export {
  normalizeName,
  noteId,
  noteUrl,
  scanNotes,
  WIKILINK,
  type WikiNote,
  type WikiOptions,
} from "./notes.ts";
export { remarkWikiLinks } from "./remark-wiki-links.ts";
export { buildSearchIndex, SEARCH_OPTIONS } from "./search.ts";
