import { writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { allocatePort } from "./port.mjs";
import { warmSite } from "./writing-warm.mjs";

if (!process.env.SERVICE_TOKEN) throw new Error("Set SERVICE_TOKEN to the content repository PAT.");
process.chdir(fileURLToPath(new URL("../code/web/", import.meta.url)));
const host = process.env.HOST ?? "127.0.0.1";
const port = await allocatePort(host, Number(process.env.PORT ?? 4280), Boolean(process.env.PORT));
const base = `http://${host}:${port}`;
await writeFile(".env.node.local", `DEV_NODE_PORT=${port}\nDEV_NODE_URL=${base}\n`);
process.env.ASTRO_NODE_AUTOSTART = "disabled";
process.env.QUIESCENT_WARM_TOKEN = crypto.randomUUID();
const entryUrl = new URL("../code/web/dist-node/server/entry.mjs", import.meta.url);
/** @type {{handler: import("node:http").RequestListener}} */
const { handler } = await import(entryUrl.href);
if (typeof handler !== "function") throw new Error("Build the Node example before starting it.");
let ready = false;
const server = createServer((request, response) => {
  if (!ready && request.headers["x-quiescent-warm"] !== process.env.QUIESCENT_WARM_TOKEN) {
    response.writeHead(503, { "Retry-After": "5", "Cache-Control": "no-store" });
    response.end("Preparing stories");
    return;
  }
  handler(request, response);
});
await new Promise(
  /** @param {(value?: void) => void} resolve */ (resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  },
);
try {
  await warmSite(base, { "X-Quiescent-Warm": process.env.QUIESCENT_WARM_TOKEN });
  ready = true;
  await writeFile(".writing-node.pid", String(process.pid));
  console.log(`Quiescent ready: ${base}/write`);
} catch (error) {
  server.closeAllConnections();
  server.close();
  throw error;
}
