import { expect, test } from "bun:test";
import { localR2Media } from "@quiescent/server";
import { fixture } from "../../server/test/forge-fixture.ts";
import { astroWriting, type RouteCache } from "../src/index.ts";

const post = {
  id: "11111111-1111-4111-8111-111111111111",
  slug: "story",
  title: "Story",
  description: "",
  body: { type: "doc", content: [] },
};
const media = localR2Media({
  async get() {
    return null;
  },
  async put() {},
});
test("publishing invalidates and warms affected pages before returning; drafts do not warm public pages", async () => {
  const events: string[] = [];
  const service = {
    ...fixture().service(),
    async publish() {
      events.push("commit");
      return { post, publishedSha: "new", headSha: "new", state: "published" as const };
    },
    async saveDraft() {
      return { post, branch: "draft", headSha: "old", state: "draft" as const };
    },
  };
  const cache: RouteCache = {
    enabled: true,
    set() {},
    async invalidate({ tags }) {
      events.push(tags!.join(","));
    },
  };
  const app = astroWriting({
    service,
    media,
    origin: "https://example.test",
    authorize: () => true,
    fetch: async (input, init) => {
      expect(init?.redirect).toBe("manual");
      events.push(new URL(String(input)).pathname);
      return new Response("html");
    },
  });
  const request = (suffix: string, method: string) =>
    new Request(`https://example.test/api/writing/posts/${post.id}${suffix}`, {
      method,
      headers: { Origin: "https://example.test", "Content-Type": "application/json" },
      body: JSON.stringify({ branch: "draft", expectedHeadSha: "old", post }),
    });
  expect((await app.api({ request: request("", "PUT"), cache })).ok).toBe(true);
  expect(events).toEqual([]);
  expect((await app.api({ request: request("/publish", "POST"), cache })).ok).toBe(true);
  expect(events).toEqual([
    "commit",
    `quiescent:posts,quiescent:post:${post.id}`,
    "/",
    "/read",
    `/read/${post.id}/story`,
    "/",
    "/read",
    `/read/${post.id}/story`,
  ]);
});
test("failed cache warming reports a committed mutation instead of claiming the Git write failed", async () => {
  const service = {
    ...fixture().service(),
    async publish() {
      return { post, publishedSha: "new", headSha: "new", state: "published" as const };
    },
  };
  const app = astroWriting({
    service,
    media,
    origin: "https://example.test",
    authorize: () => true,
    fetch: async () => new Response("unavailable", { status: 503 }),
  });
  const response = await app.api({
    request: new Request(`https://example.test/api/writing/posts/${post.id}/publish`, {
      method: "POST",
      headers: { Origin: "https://example.test" },
      body: JSON.stringify({ branch: "draft", expectedHeadSha: "old" }),
    }),
    cache: { enabled: true, set() {}, async invalidate() {} },
  });
  expect(response.ok).toBe(true);
  expect(await response.json()).toMatchObject({
    publishedSha: "new",
    cacheWarning: expect.stringContaining("Published on GitHub"),
  });
});

test("warming confirms retained cache entries and retries a delayed fill before returning", async () => {
  const service = {
    ...fixture().service(),
    async publish() {
      return { post, publishedSha: "new", headSha: "new", state: "published" as const };
    },
  };
  const visits = new Map<string, number>();
  const app = astroWriting({
    service,
    media,
    origin: "https://example.test",
    authorize: () => true,
    fetch: async (input) => {
      const path = new URL(String(input)).pathname;
      const count = (visits.get(path) ?? 0) + 1;
      visits.set(path, count);
      return new Response("html", { headers: { "cf-cache-status": count < 3 ? "MISS" : "HIT" } });
    },
  });
  const request = new Request(`https://example.test/api/writing/posts/${post.id}/publish`, {
    method: "POST",
    headers: { Origin: "https://example.test" },
    body: JSON.stringify({ branch: "draft", expectedHeadSha: "old" }),
  });
  const result = await (
    await app.api({ request, cache: { enabled: true, set() {}, async invalidate() {} } })
  ).json();
  expect(result.cacheWarning).toBeUndefined();
  expect([...visits.values()]).toEqual([3, 3, 3]);
});
