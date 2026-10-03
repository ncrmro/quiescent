import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.E2E_PORT);
if (!port) throw new Error("Run bun run test:e2e to allocate and record this checkout's port.");
export default defineConfig({
  testDir: "./tests",
  testMatch: "example.spec.ts",
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: { baseURL: `http://127.0.0.1:${port}`, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    env: { WRITING_RUNTIME: "node", SERVICE_TOKEN: "example-test-token" },
    command: `node node_modules/.bin/astro dev --ignore-lock --host 127.0.0.1 --port ${port}`,
    url: `http://127.0.0.1:${port}/login`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
