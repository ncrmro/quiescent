// @ts-check
import { fileURLToPath } from "node:url";
import cloudflare from "@astrojs/cloudflare";
import { unified } from "@astrojs/markdown-remark";
import { remarkWikiLinks } from "@quiescent/wiki";
import { quiescentWiki } from "@quiescent/wiki";
import { defineConfig } from "astro/config";

export default defineConfig({
  output: "server",
  markdown: { processor: unified({ remarkPlugins: [remarkWikiLinks({dir: fileURLToPath(new URL("./demo/wiki", import.meta.url)), base: "/demo/wiki"})] }) },
  vite: { server: { strictPort: true } },
  adapter: cloudflare({
    configPath: process.env.WRITING_CONFIG ?? "wrangler.writing-test.jsonc",
    imageService: "compile",
    sessionKVBindingName: "SESSIONS",

  }),
  integrations: [
    // The demo wiki tree, mounted under /demo/wiki so wikilink hrefs, tag
    // pages, search hits, and graph nodes all agree with the real routes.
    quiescentWiki({
      remark: false,
      dir: fileURLToPath(new URL("./demo/wiki", import.meta.url)),
      base: "/demo/wiki",
    }),
  ],
});
