import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const config = JSON.parse(readFileSync("release-please-config.json", "utf8"));
const manifest = JSON.parse(readFileSync(".release-please-manifest.json", "utf8"));
const paths = JSON.parse(process.env.RELEASE_PATHS ?? "[]");
if (!Array.isArray(paths) || paths.length === 0 || paths.some((path) => !config.packages[path]))
  throw new Error("Choose at least one configured release package");
const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
for (const path of paths) {
  const { version, private: isPrivate } = JSON.parse(readFileSync(`${path}/package.json`, "utf8"));
  if (isPrivate || manifest[path] !== version)
    throw new Error(`${path}: package version must match the release manifest and be public`);
  const tag = `${config.packages[path].component}-v${version}`;
  const release = JSON.parse(
    execFileSync("gh", ["release", "view", tag, "--json", "isDraft,isPrerelease"], {
      encoding: "utf8",
    }),
  );
  const sha = execFileSync("git", ["rev-parse", `refs/tags/${tag}^{commit}`], {
    encoding: "utf8",
  }).trim();
  if (release.isDraft || release.isPrerelease || sha !== head)
    throw new Error(`${tag}: publish from the exact stable release commit`);
  console.log(`Verified ${tag} at ${sha}`);
}
