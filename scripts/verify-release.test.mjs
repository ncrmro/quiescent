import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

test("release verification accepts only the tagged, public, manifest-matched commit", () => {
  const directory = mkdtempSync(join(tmpdir(), "release-verification-"));
  const script = resolve("scripts/verify-release.mjs");
  /** @param {...string} args */
  const git = (...args) => execFileSync("git", args, { cwd: directory, stdio: "pipe" });
  const write = (/** @type {string} */ file, /** @type {unknown} */ value) =>
    writeFileSync(join(directory, file), JSON.stringify(value));
  const run = (paths = '["code/git"]') =>
    spawnSync(process.execPath, [script], {
      cwd: directory,
      env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, RELEASE_PATHS: paths },
      encoding: "utf8",
    });
  try {
    mkdirSync(join(directory, "code/git"), { recursive: true });
    write("release-please-config.json", {
      packages: { "code/git": { component: "quiescent-git" } },
    });
    write(".release-please-manifest.json", { "code/git": "1.0.0" });
    write("code/git/package.json", { version: "1.0.0" });
    writeFileSync(
      join(directory, "gh"),
      '#!/bin/sh\nprintf \'{"isDraft":false,"isPrerelease":false}\\n\'\n',
      { mode: 0o755 },
    );
    git("init", "-q");
    git("add", ".");
    git("-c", "user.name=Test", "-c", "user.email=test@example.test", "commit", "-qm", "release");
    git("tag", "quiescent-git-v1.0.0");
    assert.equal(run().status, 0);
    assert.notEqual(run("[]").status, 0);
    assert.notEqual(run('["../unconfigured"]').status, 0);
    write("code/git/package.json", { version: "1.0.1" });
    assert.match(run().stderr, /version must match/);
    write("code/git/package.json", { version: "1.0.0", private: true });
    assert.match(run().stderr, /must.*be public/);
    write("code/git/package.json", { version: "1.0.0" });
    git(
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.test",
      "commit",
      "--allow-empty",
      "-qm",
      "later work",
    );
    assert.match(run().stderr, /exact stable release commit/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
