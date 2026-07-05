// E2E exercise of the draft->flush->commit pipeline against a real repo.
// Usage: GITHUB_TOKEN=$(gh auth token) bun scripts/e2e-flush.ts <owner> <repo> <path>
import { createMemoryStore, flushDrafts, saveDraft, type Env } from "../code/server/src/index.ts";
import type { Session } from "../code/server/src/session.ts";

const [owner, repo, path] = process.argv.slice(2);
const token = process.env.GITHUB_TOKEN;
if (!owner || !repo || !path || !token) {
  console.error("usage: GITHUB_TOKEN=... bun scripts/e2e-flush.ts <owner> <repo> <path>");
  process.exit(1);
}

const env: Env = {
  SESSIONS: createMemoryStore(),
  DRAFTS: createMemoryStore(),
  FORGE_KIND: "github",
  REPO_OWNER: owner,
  REPO_NAME: repo,
  DEFAULT_BRANCH: "main",
  OAUTH_CLIENT_ID: "e2e",
  OAUTH_CLIENT_SECRET: "e2e",
  SESSION_SECRET: "e2e".repeat(11),
};

const session: Session = {
  userId: 0,
  login: owner,
  canPush: true,
  tokens: { accessToken: token, tokenType: "bearer" },
};

const now = new Date().toISOString();
const content = [
  "---",
  'title: "Quiescent smoke test"',
  'description: "Written by the quiescent flush pipeline; not rendered (published: false)."',
  `publish_date: ${now.slice(0, 10)}`,
  "published: false",
  "tags: []",
  "---",
  "",
  `This draft was committed by quiescent's flush pipeline at ${now}.`,
  "",
].join("\n");

await saveDraft(env, {
  userId: 0,
  sessionId: "e2e",
  path,
  content,
  updatedAt: Date.now(),
});

const result = await flushDrafts({
  env,
  origin: "https://quiescent.invalid",
  sessionId: "e2e",
  session,
  drafts: [await import("../code/server/src/drafts.ts").then((m) => m.getDraft(env, 0, path))].filter(
    (d): d is NonNullable<typeof d> => d !== null,
  ),
});

console.log(JSON.stringify(result, null, 2));
