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
    user: { id: "nico@example.com", name: "Nico", email: "nico@example.com", canPush: true },
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
    const loaded = await getDraft(env, "nico@example.com", "posts/hello.md");
    expect(loaded?.content).toBe("# hello");
  });

  test("lists only the user's drafts", async () => {
    const env = testEnv();
    await saveDraft(env, draft());
    await saveDraft(
      env,
      draft({ user: { id: "other@example.com", canPush: true }, path: "posts/other.md" }),
    );
    const mine = await listUserDrafts(env, "nico@example.com");
    expect(mine.map((d) => d.path)).toEqual(["posts/hello.md"]);
  });

  test("user ids sharing a prefix do not collide", async () => {
    const env = testEnv();
    await saveDraft(env, draft({ user: { id: "nico", canPush: true } }));
    await saveDraft(env, draft({ user: { id: "nico2", canPush: true }, path: "posts/two.md" }));
    const mine = await listUserDrafts(env, "nico");
    expect(mine.map((d) => d.path)).toEqual(["posts/hello.md"]);
  });

  test("delete removes the draft", async () => {
    const env = testEnv();
    await saveDraft(env, draft());
    await deleteDraft(env, "nico@example.com", "posts/hello.md");
    expect(await getDraft(env, "nico@example.com", "posts/hello.md")).toBeNull();
  });
});
