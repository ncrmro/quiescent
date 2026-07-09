import { describe, expect, test } from "bun:test";
import { saveDraft, getDraft, type Draft } from "../src/drafts.ts";
import type { Env } from "../src/env.ts";
import { flushDrafts } from "../src/flush.ts";
import { createMemoryStore } from "../src/kv.ts";
import type { Session } from "../src/session.ts";

interface RecordedRequest {
  method: string;
  url: string;
  body?: unknown;
}

interface Route {
  method: string;
  /** Matched against the full URL with String.includes. */
  url: string;
  status?: number;
  response: unknown;
}

function createMockFetch(routes: Route[]) {
  const requests: RecordedRequest[] = [];
  const mockFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? "GET";
    requests.push({ method, url, body: init?.body ? JSON.parse(init.body as string) : undefined });
    const route = routes.find((r) => r.method === method && url.includes(r.url));
    if (!route) {
      return new Response(JSON.stringify({ message: "no mock route" }), { status: 404 });
    }
    return new Response(JSON.stringify(route.response), {
      status: route.status ?? 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  return { mockFetch, requests };
}

function makeEnv(routes: Route[], overrides: Partial<Env> = {}) {
  const { mockFetch, requests } = createMockFetch(routes);
  const env: Env = {
    SESSIONS: createMemoryStore(),
    DRAFTS: createMemoryStore(),
    FORGE_KIND: "github",
    REPO_OWNER: "ncrmro",
    REPO_NAME: "website",
    DEFAULT_BRANCH: "main",
    OAUTH_CLIENT_ID: "id",
    OAUTH_CLIENT_SECRET: "secret",
    SESSION_SECRET: "s3cret",
    fetch: mockFetch,
    ...overrides,
  };
  return { env, requests };
}

const session: Session = {
  userId: 1,
  login: "ncrmro",
  canPush: true,
  tokens: { accessToken: "gho_test" },
};

const draft: Draft = {
  userId: 1,
  sessionId: "sess-1",
  path: "code/web/src/content/blog/post.mdx",
  content: "# hi",
  updatedAt: Date.now(),
};

// Shared GitHub mock routes for the commit sequence on the quiescent branch.
const commitRoutes: Route[] = [
  { method: "GET", url: "/git/commits/", response: { tree: { sha: "tree0" } } },
  { method: "POST", url: "/git/trees", response: { sha: "tree1" } },
  { method: "POST", url: "/git/commits", response: { sha: "commit1", html_url: "http://c1" } },
  { method: "PATCH", url: "/git/refs/heads/quiescent/ncrmro", response: {} },
];

describe("flushDrafts", () => {
  test("default mode commits straight to the default branch for push users", async () => {
    const { env, requests } = makeEnv([
      { method: "GET", url: "/git/ref/heads/main", response: { object: { sha: "head1" } } },
      { method: "GET", url: "/git/commits/head1", response: { tree: { sha: "tree0" } } },
      { method: "POST", url: "/git/trees", response: { sha: "tree1" } },
      { method: "POST", url: "/git/commits", response: { sha: "commit1", html_url: "http://c1" } },
      { method: "PATCH", url: "/git/refs/heads/main", response: {} },
    ]);
    await saveDraft(env, draft);

    const result = await flushDrafts({
      env,
      origin: "https://example.com",
      sessionId: "sess-1",
      session,
      drafts: [draft],
    });

    expect(result).toEqual({ mode: "commit", url: "http://c1", sha: "commit1", paths: [draft.path] });
    expect(requests.some((r) => r.method === "POST" && r.url.includes("/pulls"))).toBe(false);
    expect(await getDraft(env, draft.userId, draft.path)).toBeNull();
  });

  test("FLUSH_MODE=pull-request opens a PR from the stable quiescent branch, never touching main", async () => {
    const { env, requests } = makeEnv(
      [
        { method: "GET", url: "/pulls?state=open", response: [] },
        { method: "GET", url: "/git/ref/heads/main", response: { object: { sha: "base1" } } },
        // quiescent/ncrmro exists but points at a stale (merged) sha.
        { method: "GET", url: "/git/ref/heads/quiescent/ncrmro", response: { object: { sha: "stale1" } } },
        ...commitRoutes,
        { method: "POST", url: "/pulls", response: { number: 9, html_url: "http://pr9" } },
      ],
      { FLUSH_MODE: "pull-request" },
    );
    await saveDraft(env, draft);

    const result = await flushDrafts({
      env,
      origin: "https://example.com",
      sessionId: "sess-1",
      session,
      drafts: [draft],
    });

    expect(result).toEqual({ mode: "pull-request", url: "http://pr9", paths: [draft.path] });
    // Stale branch was force-reset onto main's head before committing.
    const reset = requests.find(
      (r) => r.method === "PATCH" && r.url.includes("/git/refs/heads/quiescent/ncrmro"),
    );
    expect(reset?.body).toMatchObject({ sha: "base1", force: true });
    // Nothing was committed to main.
    expect(requests.some((r) => r.method === "PATCH" && r.url.includes("/git/refs/heads/main"))).toBe(false);
    expect(await getDraft(env, draft.userId, draft.path)).toBeNull();
  });

  test("reuses the open pull request instead of opening a new one per flush", async () => {
    const { env, requests } = makeEnv(
      [
        {
          method: "GET",
          url: "/pulls?state=open",
          response: [{ number: 9, html_url: "http://pr9" }],
        },
        { method: "GET", url: "/git/ref/heads/quiescent/ncrmro", response: { object: { sha: "head1" } } },
        ...commitRoutes,
      ],
      { FLUSH_MODE: "pull-request" },
    );
    await saveDraft(env, draft);

    const result = await flushDrafts({
      env,
      origin: "https://example.com",
      sessionId: "sess-1",
      session,
      drafts: [draft],
    });

    expect(result).toEqual({ mode: "pull-request", url: "http://pr9", paths: [draft.path] });
    expect(requests.some((r) => r.method === "POST" && r.url.includes("/pulls"))).toBe(false);
    expect(requests.some((r) => r.method === "POST" && r.url.includes("/git/refs"))).toBe(false);
  });
});
