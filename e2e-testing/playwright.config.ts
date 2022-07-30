import { PlaywrightTestConfig } from "@playwright/test";

const { CI, ROOT_URL, WEB_PORT = 3000 } = process.env;

const config: PlaywrightTestConfig = {
  workers: CI ? 2 : undefined,
  globalSetup: require.resolve("./src/playwright.setup.ts"),
  globalTimeout: CI ? 120000 : 60000,
  timeout: CI ? 60000 : 30000,
  reporter: CI ? [["dot"], ["junit", { outputFile: "junit.xml" }]] : "line",
  use: {
    baseURL: ROOT_URL ?? `http://localhost:${WEB_PORT}`,
    viewport: { width: 1280, height: 720 },
    ignoreHTTPSErrors: true,
    video: "retain-on-failure",
    screenshot: "only-on-failure",
  },
};

export default config;
