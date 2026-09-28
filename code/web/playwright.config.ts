import { defineConfig, devices } from "@playwright/test";

/**
 * Drives the /demo routes (blog + wiki), which run the real quiescent
 * packages against an in-memory draft store and a stubbed forge — so the
 * specs need no OAuth app, token, or KV binding.
 *
 * Browsers come from the Nix-managed bundle devenv puts on
 * PLAYWRIGHT_BROWSERS_PATH; do not run `playwright install`.
 */
const PORT = Number(process.env.DEMO_PORT ?? 4173);

export default defineConfig({
  testDir: "./tests",
  testIgnore: "writing-live.spec.ts",
  fullyParallel: false, // the demo forge and draft store are shared module state
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `node node_modules/.bin/astro dev --host 127.0.0.1 --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}/demo`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
