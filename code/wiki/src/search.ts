import MiniSearch, { type Options as MiniSearchOptions } from "minisearch";
import type { WikiIndex } from "./graph.ts";

/**
 * Shared between the build-time indexer and the client loader — MiniSearch
 * requires identical options when deserializing.
 */
export const SEARCH_OPTIONS: MiniSearchOptions = {
  idField: "url",
  fields: ["title", "tags", "headings", "text"],
  storeFields: ["url", "relPath", "title", "type", "tags", "excerpt"],
  searchOptions: {
    prefix: true,
    fuzzy: 0.2,
    boost: { title: 3, tags: 2, headings: 2 },
  },
};

/** Serialized MiniSearch index, ready to bake into the bundle or serve as JSON. */
export function buildSearchIndex(index: WikiIndex): string {
  const search = new MiniSearch(SEARCH_OPTIONS);
  search.addAll(
    index.notes.map((note) => ({
      url: note.url,
      relPath: note.relPath,
      title: note.title ?? note.basename,
      type: note.type,
      tags: note.tags.join(" "),
      headings: note.headings.join(" "),
      text: note.text,
      excerpt: note.excerpt,
    })),
  );
  return JSON.stringify(search);
}
