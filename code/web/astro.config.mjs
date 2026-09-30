// @ts-check
import { fileURLToPath } from "node:url";
import cloudflare from "@astrojs/cloudflare";
import { unified } from "@astrojs/markdown-remark";
import { remarkWikiLinks } from "@quiescent/wiki";
import { quiescentWiki } from "@quiescent/wiki";
import node from "@astrojs/node";
import {cacheCloudflare} from "@astrojs/cloudflare/cache";
import { defineConfig, memoryCache } from "astro/config";

const selfHosted=process.env.WRITING_RUNTIME === "node";
const demo=process.env.WRITING_CONFIG === "wrangler.jsonc";
export default defineConfig({
  session:false,
  cache: {provider:selfHosted || demo ? memoryCache() : cacheCloudflare()},
  outDir:selfHosted ? "./dist-node" : "./dist",
  output: "server",
  markdown: { processor: unified({ remarkPlugins: [remarkWikiLinks({dir: fileURLToPath(new URL("./demo/wiki", import.meta.url)), base: "/demo/wiki"})] }) },
  vite: { server: { strictPort: true },resolve:{alias:{"quiescent:runtime":fileURLToPath(new URL(`./src/runtime/${selfHosted ? "node" : "cloudflare"}.ts`,import.meta.url))}} },
  adapter: selfHosted ? node({mode:"standalone"}) : cloudflare({
    configPath: process.env.WRITING_CONFIG ?? "wrangler.writing-test.jsonc",
    imageService: "compile",

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
