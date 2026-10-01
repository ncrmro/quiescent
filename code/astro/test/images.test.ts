import { expect, test } from "bun:test";
import type { APIContext } from "astro";
import type { RouteCache } from "../src/documents.ts";
import { documentImageResponse } from "../src/images.ts";

test("optimized images keep document visibility and invalidation instead of caching a private source", async () => {
  let published = false;
  let transformed = 0;
  let tags: string[] = [];
  const options = {
    request: new Request(
      "https://example.test/_image?href=%2Fmedia%2Fpost%2Fgarden.png&w=360&h=240&f=webp&q=80",
    ),
    cache: {
      enabled: true,
      set(value: false | { tags?: string[] }) {
        if (value) tags = value.tags ?? [];
      },
      async invalidate() {},
    },
    cacheImage: (cache: RouteCache, id: string) => cache.set({ tags: [`quiescent:post:${id}`] }),
    logger: { warn() {}, error() {}, info() {}, debug() {} } as APIContext["logger"],
    source: async () => new Response("image", { status: published ? 200 : 404 }),
    transform: async () => {
      transformed++;
      return new Response("webp", {
        headers: {
          "Content-Type": "image/webp",
          "Cache-Control": "public, max-age=31536000, immutable",
        },
      });
    },
  };
  expect((await documentImageResponse(options)).status).toBe(404);
  expect(transformed).toBe(0);
  published = true;
  const response = await documentImageResponse(options);
  expect(response.status).toBe(200);
  expect(tags).toContain("quiescent:post:post");
  expect(response.headers.get("Cache-Control")).toBe("public, max-age=0, must-revalidate");
  published = false;
  expect((await documentImageResponse(options)).status).toBe(404);
  expect(transformed).toBe(1);
  for (const href of [
    "https://example.test/private.png",
    "/api/documents/post/media/garden.png",
    "/media/post/../secret",
  ]) {
    const url = new URL(options.request.url);
    url.searchParams.set("href", href);
    expect((await documentImageResponse({ ...options, request: new Request(url) })).status).toBe(
      400,
    );
  }
});
