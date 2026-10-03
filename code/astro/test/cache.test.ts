import { expect, test } from "bun:test";
import type { RouteCache } from "../src/index.ts";
import { astroDocumentCache } from "../src/index.ts";

test("custom collections tag and eagerly warm only their configured public routes", async () => {
  const events: string[] = [];
  let currentTags: string[] = [];
  const pages = astroDocumentCache<{ id: string; slug: string }>({
    collection: "recipes",
    origin: "https://example.test",
    indexPaths: ["/recipes"],
    documentPath: (d) => `/recipes/${d.slug}`,
    fetch: async (input) => {
      const path = new URL(String(input)).pathname;
      events.push(path);
      return new Response("page", { status: path.endsWith("/deleted") ? 404 : 200 });
    },
  });
  const cache: RouteCache = {
    enabled: true,
    set(value) {
      if (value) currentTags = value.tags ?? [];
    },
    async invalidate({ tags }) {
      events.push(tags!.join(","));
    },
  };
  pages.set(cache, "one");
  expect(currentTags).toContain("quiescent:recipes:one");
  await pages.afterPublication(cache, { id: "one", slug: "dinner" }, false);
  expect(events).toEqual([
    "quiescent:recipes,quiescent:recipes:one",
    "/recipes",
    "/recipes/dinner",
    "/recipes",
    "/recipes/dinner",
  ]);
  events.length = 0;
  await pages.afterPublication(cache, { id: "one", slug: "deleted" }, true);
  expect(events).toContain("/recipes/deleted");
});

test("renames invalidate the previous URL and warm its missing page", async () => {
  const invalidated: string[] = [];
  const warmed: string[] = [];
  const pages = astroDocumentCache<{ id: string; slug: string }>({
    collection: "recipes",
    origin: "https://example.test",
    documentPath: (d) => `/recipes/${d.slug}`,
    affectedPaths: () => ["/recipes"],
    fetch: async (url) => {
      const path = new URL(String(url)).pathname;
      warmed.push(path);
      return new Response("", { status: path === "/recipes/old" ? 404 : 200 });
    },
  });
  const cache: RouteCache = {
    enabled: true,
    set() {},
    async invalidate({ path }) {
      if (path) invalidated.push(path);
    },
  };
  await pages.afterPublication(cache, { id: "one", slug: "new" }, false, {
    id: "one",
    slug: "old",
  });
  expect(invalidated).toContain("/recipes/old");
  expect(invalidated).toContain("/recipes");
  expect(warmed).toContain("/recipes/new");
  expect(warmed).toContain("/recipes/old");
});

test("external snapshot refresh invalidates and warms changed, renamed and deleted public pages", async () => {
  const paths: string[] = [];
  const tags: string[] = [];
  const pages = astroDocumentCache<{ id: string; slug: string; body: string }>({
    collection: "posts",
    origin: "https://test",
    indexPaths: ["/"],
    documentPath: (d) => `/posts/${d.slug}`,
    fetch: async (input) => {
      const path = new URL(String(input)).pathname;
      paths.push(path);
      return new Response("", {
        status: ["/posts/old", "/posts/deleted"].includes(path) ? 404 : 200,
      });
    },
  });
  const cache: RouteCache = {
    enabled: true,
    set() {},
    async invalidate(value) {
      tags.push(...(value.tags ?? []));
    },
  };
  await pages.afterRefresh(
    cache,
    [
      { id: "one", slug: "old", body: "before" },
      { id: "two", slug: "deleted", body: "removed" },
    ],
    [{ id: "one", slug: "new", body: "after" }],
  );
  expect(tags).toContain("quiescent:collection:posts");
  expect(new Set(paths)).toEqual(new Set(["/", "/posts/old", "/posts/new", "/posts/deleted"]));
  paths.length = 0;
  await pages.afterRefresh(
    cache,
    [{ id: "one", slug: "new", body: "after" }],
    [{ id: "one", slug: "new", body: "after" }],
  );
  expect(paths).toEqual([]);
  await pages.afterRefresh(
    cache,
    [{ id: "one", slug: "new", body: "after" }],
    [{ id: "one", slug: "new", body: "after" }],
    true,
  );
  expect(new Set(paths)).toEqual(new Set(["/", "/posts/new"]));
  paths.length = 0;
  await pages.afterRefresh(cache, [], [], true);
  expect(new Set(paths)).toEqual(new Set(["/"]));
});

test("stale document snapshots cannot be retained as fresh HTML", () => {
  const settings: unknown[] = [];
  const cache: RouteCache = {
    enabled: true,
    set(value) {
      settings.push(value);
    },
    async invalidate() {},
  };
  const pages = astroDocumentCache<{ id: string }>({
    collection: "posts",
    origin: "https://test",
    documentPath: (d) => `/posts/${d.id}`,
    maxAge: 3600,
  });
  pages.set(cache, "one", {
    fetchedAt: Date.now() - 1000,
    expiresAt: Date.now() + 600000,
    updatedAt: Date.now(),
    stale: true,
    refreshing: true,
  });
  expect(settings).toEqual([false]);
  pages.set(cache, "one", {
    fetchedAt: Date.now() - 1800000,
    expiresAt: Date.now() + 600000,
    updatedAt: Date.now(),
    stale: false,
    refreshing: false,
  });
  expect((settings[1] as { maxAge: number }).maxAge).toBeLessThanOrEqual(600);
});

test("SQL field ordering does not invalidate unchanged content and readers share revision headers", async () => {
  const events: string[] = [];
  const pages = astroDocumentCache<{ id: string; frontmatter: object; body: string }>({
    collection: "posts",
    origin: "https://test",
    documentPath: (d) => `/posts/${d.id}`,
    fetch: async () => {
      events.push("warm");
      return new Response("page");
    },
  });
  const cache: RouteCache = {
    enabled: true,
    set() {},
    async invalidate() {
      events.push("invalidate");
    },
  };
  await pages.afterRefresh(
    cache,
    [{ frontmatter: { title: "Same", tags: ["one", "two"] }, body: "Text", id: "one" }],
    [{ id: "one", body: "Text", frontmatter: { tags: ["one", "two"], title: "Same" } }],
  );
  expect(events).toEqual([]);
  const headers = new Headers();
  pages.setReaderHeaders(headers, "immutable-sha");
  expect(headers.get("X-Quiescent-Revision")).toBe("immutable-sha");
  expect(headers.get("X-Quiescent-Rendered")).toBeTruthy();
});

test("expired or failed document snapshots never populate HTML cache", () => {
  const settings: unknown[] = [];
  const cache: RouteCache = {
    enabled: true,
    set(value) {
      settings.push(value);
    },
    async invalidate() {},
  };
  const pages = astroDocumentCache<{ id: string }>({
    collection: "posts",
    origin: "https://test",
    documentPath: (d) => `/posts/${d.id}`,
    maxAge: 86400,
  });
  const status = {
    fetchedAt: Date.now(),
    updatedAt: null,
    expiresAt: Date.now() - 1,
    stale: false,
    refreshing: false,
  };
  pages.set(cache, "one", status);
  pages.set(cache, "one", { ...status, expiresAt: Date.now() + 60000, error: "Unavailable" });
  expect(settings).toEqual([false, false]);
});
