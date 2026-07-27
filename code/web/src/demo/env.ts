import { createMemoryStore, type Env, type WikiUser } from "@quiescent/server";
import { createDemoForge } from "./forge.ts";

/**
 * Everything the /demo routes need to run the real quiescent stack with no
 * forge, no OAuth app, and no KV binding: an in-memory draft store, a stubbed
 * forge injected via `Env.fetch`, and a fixed signed-in user.
 *
 * State is module-level, so it lives as long as the dev server / worker
 * isolate — long enough to demo an edit landing as a commit, short enough
 * that a restart resets the content.
 */

// Vite inlines these at build time, so the demo content ships with the app
// instead of being read from disk at request time (Workers have no fs).
const blog = import.meta.glob("../../demo/blog/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;
const wiki = import.meta.glob("../../demo/wiki/**/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

function seed(): Record<string, string> {
  const files: Record<string, string> = {};
  for (const [path, source] of Object.entries(blog)) {
    files[`content/blog/${path.split("/").pop()}`] = source;
  }
  for (const [path, source] of Object.entries(wiki)) {
    files[`wiki/${path.split("/demo/wiki/")[1]}`] = source;
  }
  return files;
}

export const demoForge = createDemoForge(seed());

const drafts = createMemoryStore();

export const DEMO_USER: WikiUser = {
  id: "demo@quiescent.invalid",
  name: "Demo Editor",
  email: "demo@quiescent.invalid",
  // Push access → notes mode: drafts flush straight to the default branch.
  canPush: true,
};

export function demoEnv(): Env {
  return {
    DRAFTS: drafts,
    FORGE_KIND: "github",
    REPO_OWNER: "quiescent",
    REPO_NAME: "demo",
    DEFAULT_BRANCH: "main",
    SERVICE_TOKEN: "demo-token",
    fetch: demoForge.fetch,
  };
}
