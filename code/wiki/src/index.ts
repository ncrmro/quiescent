// Build-time / server-side API. Everything here may touch node:fs — do not
// import from client islands; use "@quiescent/wiki/client" there.
export {
  scanNotes,
  noteId,
  normalizeName,
  WIKILINK,
  type WikiOptions,
  type WikiNote,
} from "./notes.ts";
export {
  buildWikiIndex,
  resolveWikiTarget,
  buildWikiGraph,
  buildTagIndex,
  type WikiIndex,
  type WikiGraph,
  type WikiGraphNode,
  type WikiGraphEdge,
} from "./graph.ts";
export { buildSearchIndex, SEARCH_OPTIONS } from "./search.ts";
export { remarkWikiLinks } from "./remark-wiki-links.ts";
export {
  validateWikiLinks,
  reportWikiLinks,
  type LinkReport,
  type DeadLink,
} from "./check-links.ts";
export { quiescentWiki, type QuiescentWikiOptions } from "./astro/integration.ts";
