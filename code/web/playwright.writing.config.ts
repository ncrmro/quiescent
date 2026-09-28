import { defineConfig, devices } from "@playwright/test";

const enabled = process.env.QUIESCENT_LIVE_TEST === "1";
if (enabled && !process.env.BASE_URL) {
  throw new Error("BASE_URL must identify the already-running local Wrangler writing app.");
}

/** Opt-in acceptance against real GitHub and R2. The caller owns the Worker lifecycle. */
export default defineConfig({
  testDir: "./tests",
  testMatch: "writing-live.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 240_000,
  expect: { timeout: 40_000 },
  reporter: [["list"]],
  use: {
    baseURL: process.env.BASE_URL,
    httpCredentials: process.env.WRITING_TEST_PASSWORD ? { username: "writer", password: process.env.WRITING_TEST_PASSWORD } : undefined,
    // Signed upload URLs are credentials; do not retain network traces or HARs.
    trace: "off",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
