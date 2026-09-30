import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { allocatePort } from "./port.mjs";

const host = process.env.WRITING_HOST ?? "127.0.0.1";
const recorded = existsSync(".env.local")
  ? readFileSync(".env.local", "utf8").match(/^DEV_PORT=(\d+)$/m)?.[1]
  : undefined;
const port = await allocatePort(host, Number(process.env.DEV_PORT || recorded || 4180));
writeFileSync(".env.local", `DEV_PORT=${port}\nDEV_URL=http://${host}:${port}\n`);
console.log(port);
