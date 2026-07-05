import { describe, expect, test } from "bun:test";
import { getDraft, listUserDrafts, saveDraft, deleteDraft, type Draft } from "../src/drafts.ts";
import { createMemoryStore } from "../src/kv.ts";
import type { Env } from "../src/env.ts";

function testEnv(): Env {
  return {
    SESSIONS: createMemoryStore(),
    DRAFTS: createMemoryStore(),
    FORGE_KIND: "github",
    REPO_OWNER: "octo",
    REPO_NAME: "repo",
    DEFAULT_BRANCH: "main",
    OAUTH_CLIENT_ID: "id",
    OAUTH_CLIENT_SECRET: "secret",
    SESSION_SECRET: "s".repeat(32),
  };
}

function draft(overrides: Partial<Draft> = {}): Draft {
  return {
    userId: 1,
    sessionId: "sess",
    path: "posts/hello.md",
    content: "# hello",
    updatedAt: Date.now(),
    ...overrides,
  };
}

describe("drafts on a KeyValueStore", () => {
  test("round-trips a draft", async () => {
    const env = testEnv();
    await saveDraft(env, draft());
    const loaded = await getDraft(env, 1, "posts/hello.md");
    expect(loaded?.content).toBe("# hello");
  });

  test("lists only the user's drafts", async () => {
    const env = testEnv();
    await saveDraft(env, draft());
    await saveDraft(env, draft({ userId: 2, path: "posts/other.md" }));
    const mine = await listUserDrafts(env, 1);
    expect(mine.map((d) => d.path)).toEqual(["posts/hello.md"]);
  });

  test("delete removes the draft", async () => {
    const env = testEnv();
    await saveDraft(env, draft());
    await deleteDraft(env, 1, "posts/hello.md");
    expect(await getDraft(env, 1, "posts/hello.md")).toBeNull();
  });
});
