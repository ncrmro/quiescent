import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const order = ["code/git", "code/server", "code/editor", "code/astro", "code/wiki"];
const requested = JSON.parse(process.env.RELEASE_PATHS ?? "[]");
if (!Array.isArray(requested) || requested.some((path) => !order.includes(path)))
  throw new Error("Invalid release package list");
for (const path of order.filter((path) => requested.includes(path))) {
  const { name, version } = JSON.parse(readFileSync(`${path}/package.json`, "utf8"));
  execFileSync("npm", ["view", name, "name"], { stdio: "inherit" });
  const versions = JSON.parse(
    execFileSync("npm", ["view", name, "versions", "--json"], { encoding: "utf8" }),
  );
  if ([versions].flat().includes(version)) {
    console.log(`${name}@${version} is already published`);
    continue;
  }
  execFileSync("npm", ["publish", "--access", "public"], { cwd: path, stdio: "inherit" });
}
