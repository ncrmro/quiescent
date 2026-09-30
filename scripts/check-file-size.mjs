import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const paths = new Set(
  execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
    encoding: "utf8",
  }).split("\0"),
);
const source = /\.(?:[cm]?[jt]sx?|astro|css|sh)$/;
let failures = 0;
for (const path of paths) {
  if (!source.test(path) || path.endsWith(".d.ts") || !existsSync(path)) continue;
  const text = readFileSync(path, "utf8");
  const lines = text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
  if (lines > 1000) {
    console.error(`${path}: ${lines} lines (maximum 1000); split by responsibility.`);
    failures++;
  }
}
if (failures) process.exitCode = 1;
else console.log("All source files are at most 1000 lines.");
