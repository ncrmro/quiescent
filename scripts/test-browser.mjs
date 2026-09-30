import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { allocatePort } from "./port.mjs";

const port = await allocatePort(
  "127.0.0.1",
  Number(process.env.E2E_PORT ?? 4173),
  Boolean(process.env.E2E_PORT),
);
const root = fileURLToPath(new URL("../", import.meta.url));
await writeFile(
  new URL("../code/web/.env.e2e.local", import.meta.url),
  `DEV_E2E_PORT=${port}\nDEV_E2E_URL=http://127.0.0.1:${port}\n`,
);
const child = spawn(
  process.execPath,
  [
    "code/web/node_modules/@playwright/test/cli.js",
    "test",
    "--config",
    "code/web/playwright.config.ts",
    ...process.argv.slice(2),
  ],
  {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, E2E_PORT: String(port) },
  },
);
child.on("error", (error) => {
  throw error;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
