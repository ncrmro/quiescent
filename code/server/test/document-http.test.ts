import { expect, test } from "bun:test";
import { createDocumentHandler } from "../src/document-http.ts";
import { fixture } from "./forge-fixture.ts";

test("cache failure reports a committed publication and retry does not commit again", async () => {
  const f = fixture();
  const store = f.service();
  const draft = await store.createDocument({
    frontmatter: { title: "Dinner", slug: "dinner" },
    body: "Recipe",
  });
  const handler = createDocumentHandler({
    store,
    authorize: () => true,
    afterPublication: async () => {
      throw new Error("cache unavailable");
    },
  });
  const request = () =>
    new Request(`https://test/api/documents/${draft.document.id}/publish`, {
      method: "POST",
      headers: { Origin: "https://test" },
      body: JSON.stringify({ branch: draft.branch, expectedHeadSha: draft.headSha }),
    });
  expect(await (await handler(request())).json()).toMatchObject({
    cacheWarning: expect.any(String),
  });
  const count = f.commits.size;
  expect((await handler(request())).ok).toBe(true);
  expect(f.commits.size).toBe(count);
  expect((await store.getPublished(draft.document.id))?.document.body).toBe("Recipe");
});

test("listing metadata and refresh require authorization; refresh additionally requires same origin", async () => {
  const store = fixture().service();
  let reads = 0;
  let refreshes = 0;
  const listing = {
    documents: [],
    cache: { expiresAt: 1001, fetchedAt: 1, updatedAt: 1, stale: false, refreshing: false },
  };
  const handler = createDocumentHandler({
    store: {
      ...store,
      listDocumentsWithStatus: async () => {
        reads++;
        return listing;
      },
      refreshDocuments: async () => {
        refreshes++;
        return listing;
      },
    },
    authorize: (request) => request.headers.get("Authorization") === "test",
  });
  expect((await handler(new Request("https://test/api/documents/listing"))).status).toBe(403);
  const read = await handler(
    new Request("https://test/api/documents/listing", { headers: { Authorization: "test" } }),
  );
  expect(await read.json()).toEqual(listing);
  expect(read.headers.get("Cache-Control")).toContain("no-store");
  const refresh = (origin: string) =>
    handler(
      new Request("https://test/api/documents/listing/refresh", {
        method: "POST",
        headers: { Authorization: "test", Origin: origin },
      }),
    );
  expect((await refresh("https://other")).status).toBe(403);
  expect(await (await refresh("https://test")).json()).toEqual(listing);
  expect(reads).toBe(1);
  expect(refreshes).toBe(1);
});
