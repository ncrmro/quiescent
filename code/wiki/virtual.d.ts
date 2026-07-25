/**
 * Types for the `virtual:quiescent-wiki` module provided by the
 * `quiescentWiki()` Astro integration. Reference from your app's env.d.ts:
 *
 *   /// <reference types="@quiescent/wiki/virtual" />
 */
declare module "virtual:quiescent-wiki" {
  import type { WikiGraph, WikiNote } from "@quiescent/wiki";

  /** Serialized MiniSearch index; load with `loadWikiSearch` or `MiniSearch.loadJSON`. */
  export const searchIndex: string;
  export const graph: WikiGraph;
  /** Tag → notes carrying it. */
  export const tags: Record<string, Array<{ url: string; title: string }>>;
  /** Note metadata without the full text body. */
  export const notes: Array<Omit<WikiNote, "text">>;
}
