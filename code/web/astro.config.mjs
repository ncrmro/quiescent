// @ts-check
import { fileURLToPath } from "node:url";
import cloudflare from "@astrojs/cloudflare";
import { quiescentWiki } from "@quiescent/wiki";
import { defineConfig } from "astro/config";

export default defineConfig({
  output: "server",
  adapter: cloudflare({
    platformProxy: { enabled: true },
    sessionKVBindingName: "SESSIONS",
    workerEntryPoint: { path: "src/worker.ts" },
  }),
  integrations: [
    // Demo wiki content; point `dir` at your own wiki tree.
    quiescentWiki({ dir: fileURLToPath(new URL("../wiki/test/fixtures/wiki", import.meta.url)) }),
  ],
});
