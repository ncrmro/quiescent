import { describe, expect, test } from "bun:test";
import { MissingAuthorEmailError, serviceTokenSource } from "../src/auth.ts";
import { listUserDrafts, saveDraft, type Draft } from "../src/drafts.ts";
import type { Env } from "../src/env.ts";
import { flushDrafts, flushStaleDrafts, CRON_FLUSH_AFTER_MS } from "../src/flush.ts";
import { createMemoryStore } from "../src/kv.ts";
import { createSession } from "../src/session.ts";

interface Recorded {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: Record<string, unknown>;
}

/** Minimal GitHub API mock covering the blob-less commit sequence. */
function githubMock() {
  const requests: Recorded[] = [];
  const mockFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? "GET";
    requests.push({
      method,
      url,
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: init?.body ? JSON.parse(init.body as string) : undefined,
    });
    const respond = (data: unknown) =>
      new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });
    if (url.includes("/git/ref/heads/")) return respond({ object: { sha: "head1" } });
    if (url.includes("/git/commits/head1")) return respond({ tree: { sha: "tree0" } });
    if (url.endsWith("/git/trees")) return respond({ sha: "tree1" });
    if (url.endsWith("/git/commits")) return respond({ sha: "commit1", html_url: "http://c" });
    if (url.includes("/git/refs/heads/")) return respond({});
    return new Response(JSON.stringify({ message: "no mock route" }), { status: 404 });
  }) as typeof fetch;
  return { mockFetch, requests };
}

function testEnv(overrides: Partial<Env> = {}): Env {
  return {
    SESSIONS: createMemoryStore(),
    DRAFTS: createMemoryStore(),
    FORGE_KIND: "github",
    REPO_OWNER: "octo",
    REPO_NAME: "repo",
    DEFAULT_BRANCH: "main",
    SESSION_SECRET: "s".repeat(32),
    ...overrides,
  };
}

function draft(overrides: Partial<Draft> = {}): Draft {
  return {
    user: { id: "nico@example.com", name: "Nico", email: "nico@example.com", canPush: true },
    path: "wiki/note.md",
    content: "# note",
    updatedAt: Date.now(),
    ...overrides,
  };
}

describe("flushDrafts in service-token mode", () => {
  test("commits with author override, trailer, and service token; clears drafts", async () => {
    const { mockFetch, requests } = githubMock();
    const env = testEnv({ SERVICE_TOKEN: "svc_token", fetch: mockFetch });
    const d = draft();
    await saveDraft(env, d);

    const result = await flushDrafts({
      env,
      origin: "https://wiki.example",
      user: d.user,
      drafts: [d],
    });

    expect(result?.mode).toBe("commit");
    expect(result?.sha).toBe("commit1");

    const commit = requests.find((r) => r.method === "POST" && r.url.endsWith("/git/commits"));
    expect(commit?.headers.authorization).toBe("Bearer svc_token");
    expect(commit?.body?.author).toEqual({ name: "Nico", email: "nico@example.com" });
    expect(commit?.body?.message).toContain("Co-authored-by: Nico <nico@example.com>");

    expect(await listUserDrafts(env, d.user.id)).toEqual([]);
  });

  test("short-circuits before any forge call when the user has no email", async () => {
    const { mockFetch, requests } = githubMock();
    const env = testEnv({ SERVICE_TOKEN: "svc_token", fetch: mockFetch });
    const d = draft({ user: { id: "anon", name: "Anon", canPush: true } });
    await saveDraft(env, d);

    await expect(
      flushDrafts({ env, origin: "https://wiki.example", user: d.user, drafts: [d] }),
    ).rejects.toBeInstanceOf(MissingAuthorEmailError);

    expect(requests).toEqual([]);
    // Draft survives for the user's next visit.
    expect((await listUserDrafts(env, "anon")).map((x) => x.path)).toEqual(["wiki/note.md"]);
  });

  test("serviceTokenSource requires an email", async () => {
    const source = serviceTokenSource("t");
    await expect(source.getCommitIdentity({ id: "x", canPush: true })).rejects.toBeInstanceOf(
      MissingAuthorEmailError,
    );
  });
});

describe("flushDrafts in forge-OAuth mode", () => {
  test("uses the session's token with no author override", async () => {
    const { mockFetch, requests } = githubMock();
    const env = testEnv({ fetch: mockFetch });
    const sessionId = await createSession(env, {
      userId: 7,
      login: "ncrmro",
      canPush: true,
      tokens: { accessToken: "user_token" },
    });
    const user = { id: "7", name: "ncrmro", canPush: true };
    const d = draft({ user, sessionId });
    await saveDraft(env, d);

    const result = await flushDrafts({
      env,
      origin: "https://wiki.example",
      user,
      sessionId,
      drafts: [d],
    });

    expect(result?.mode).toBe("commit");
    const commit = requests.find((r) => r.method === "POST" && r.url.endsWith("/git/commits"));
    expect(commit?.headers.authorization).toBe("Bearer user_token");
    expect(commit?.body?.author).toBeUndefined();
    expect(commit?.body?.message).not.toContain("Co-authored-by");
  });
});

describe("flushStaleDrafts", () => {
  test("flushes only drafts idle past the threshold, grouped per user", async () => {
    const { mockFetch, requests } = githubMock();
    const env = testEnv({ SERVICE_TOKEN: "svc_token", fetch: mockFetch });
    const now = Date.now();
    const staleUser = { id: "a@example.com", email: "a@example.com", canPush: true };
    await saveDraft(env, draft({ user: staleUser, updatedAt: now - CRON_FLUSH_AFTER_MS - 1 }));
    await saveDraft(
      env,
      draft({
        user: { id: "b@example.com", email: "b@example.com", canPush: true },
        path: "wiki/fresh.md",
        updatedAt: now,
      }),
    );

    await flushStaleDrafts(env, now);

    const commits = requests.filter((r) => r.method === "POST" && r.url.endsWith("/git/commits"));
    expect(commits).toHaveLength(1);
    expect(await listUserDrafts(env, "a@example.com")).toEqual([]);
    expect((await listUserDrafts(env, "b@example.com")).map((d) => d.path)).toEqual([
      "wiki/fresh.md",
    ]);
  });
});
