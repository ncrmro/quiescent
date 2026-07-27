import { glob } from "astro/loaders";
import { defineCollection, z } from "astro:content";

/**
 * The demo wiki tree as a content collection. The glob runs at build time, so
 * every note is bundled — no runtime filesystem, which is what lets the same
 * code run on Workers. Frontmatter varies by note type, so the schema types
 * only what the listing uses and passes the rest through.
 */
const wiki = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./demo/wiki" }),
  schema: z
    .object({
      title: z.string().optional(),
      type: z.string().optional(),
      status: z.string().optional(),
      tags: z.array(z.string()).optional(),
    })
    .passthrough(),
});

export const collections = { wiki };
