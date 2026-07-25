import type { AstroIntegration } from "astro";
import { buildTagIndex, buildWikiGraph, buildWikiIndex } from "../graph.ts";
import type { WikiOptions } from "../notes.ts";
import { remarkWikiLinks } from "../remark-wiki-links.ts";
import { buildSearchIndex } from "../search.ts";

const VIRTUAL_ID = "virtual:quiescent-wiki";
const RESOLVED_ID = `\0${VIRTUAL_ID}`;

export interface QuiescentWikiOptions extends WikiOptions {
  /** Add tag nodes + membership edges to the graph (Obsidian style). Default true. */
  tagsInGraph?: boolean;
  /**
   * Inject the wikilink remark plugin via `markdown.remarkPlugins`. Works with
   * Astro's classic markdown pipeline (≤6). Astro 7's default `satteri`
   * processor ignores `remarkPlugins` — set this to false and wire the plugin
   * yourself: `markdown.processor: unified({ remarkPlugins: [remarkWikiLinks({ dir })] })`
   * with `unified` from `@astrojs/markdown-remark`. Default true.
   */
  remark?: boolean;
}

/**
 * Wires the wiki into an Astro site: registers the wikilink remark plugin and
 * exposes `virtual:quiescent-wiki` — search index, graph, tag index, and note
 * metadata, all computed once at build time and baked into the bundle so the
 * same code runs on Cloudflare Workers (no runtime FS) and Node.
 */
export function quiescentWiki(options: QuiescentWikiOptions): AstroIntegration {
  return {
    name: "quiescent-wiki",
    hooks: {
      "astro:config:setup": ({ updateConfig }) => {
        updateConfig({
          ...(options.remark === false
            ? {}
            : { markdown: { remarkPlugins: [remarkWikiLinks(options)] } }),
          vite: {
            plugins: [
              {
                name: "quiescent-wiki-virtual",
                resolveId(id: string) {
                  if (id === VIRTUAL_ID) return RESOLVED_ID;
                },
                load(id: string) {
                  if (id !== RESOLVED_ID) return;
                  const index = buildWikiIndex(options);
                  const graph = buildWikiGraph(index, {
                    includeTags: options.tagsInGraph ?? true,
                  });
                  const notes = index.notes.map(({ text, ...meta }) => meta);
                  return [
                    `export const searchIndex = ${JSON.stringify(buildSearchIndex(index))};`,
                    `export const graph = ${JSON.stringify(graph)};`,
                    `export const tags = ${JSON.stringify(buildTagIndex(index))};`,
                    `export const notes = ${JSON.stringify(notes)};`,
                  ].join("\n");
                },
              },
            ],
          },
        });
      },
    },
  };
}
