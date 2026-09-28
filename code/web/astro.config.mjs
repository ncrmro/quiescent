// @ts-check
import { fileURLToPath } from "node:url";
import cloudflare from "@astrojs/cloudflare";
import { quiescentWiki } from "@quiescent/wiki";
import { defineConfig } from "astro/config";

export default defineConfig({
  output: "server",
  vite: { server: { strictPort: true } },
  adapter: cloudflare({
    platformProxy: { enabled: true },
    sessionKVBindingName: "SESSIONS",
    workerEntryPoint: { path: "src/worker.ts" },
  }),
  integrations: [
    // The demo wiki tree, mounted under /demo/wiki so wikilink hrefs, tag
    // pages, search hits, and graph nodes all agree with the real routes.
    quiescentWiki({
      dir: fileURLToPath(new URL("./demo/wiki", import.meta.url)),
      base: "/demo/wiki",
    }),
  ],
});
