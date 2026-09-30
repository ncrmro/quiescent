// @ts-check
import { fileURLToPath } from "node:url";
import cloudflare from "@astrojs/cloudflare";
import { cacheCloudflare } from "@astrojs/cloudflare/cache";
import node from "@astrojs/node";
import { defineConfig, memoryCache } from "astro/config";

const selfHosted = process.env.WRITING_RUNTIME === "node";
export default defineConfig({
  session: false,
  cache: { provider: selfHosted ? memoryCache() : cacheCloudflare() },
  outDir: selfHosted ? "./dist-node" : "./dist",
  output: "server",
  vite: {
    server: { strictPort: true },
    resolve: {
      alias: {
        "quiescent:runtime": fileURLToPath(
          new URL(`./src/runtime/${selfHosted ? "node" : "cloudflare"}.ts`, import.meta.url),
        ),
      },
    },
  },
  adapter: selfHosted
    ? node({ mode: "standalone" })
    : cloudflare({
        configPath: process.env.WRITING_CONFIG ?? "wrangler.writing-test.jsonc",
        imageService: "compile",
      }),
});
