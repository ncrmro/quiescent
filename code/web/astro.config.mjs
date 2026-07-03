// @ts-check
import cloudflare from "@astrojs/cloudflare";
import { defineConfig } from "astro/config";

export default defineConfig({
  output: "server",
  adapter: cloudflare({
    platformProxy: { enabled: true },
    sessionKVBindingName: "SESSIONS",
    workerEntryPoint: { path: "src/worker.ts" },
  }),
});
