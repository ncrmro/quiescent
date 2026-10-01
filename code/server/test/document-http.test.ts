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
