import { expect, test } from "bun:test";
import { fixture } from "../../server/test/forge-fixture.ts";
import { astroDocuments, type RouteCache } from "../src/index.ts";

test("generic handler warms publication but not draft saves", async () => {
  const store = fixture().service();
  const paths: string[] = [];
  const cache: RouteCache = { enabled: true, set() {}, async invalidate() {} };
  const app = astroDocuments({
    store,
    collection: "posts",
    origin: "https://test",
    authorize: () => true,
    indexPaths: ["/"],
    documentPath: (d) => `/posts/${d.frontmatter.slug}`,
    fetch: async (url) => {
      paths.push(new URL(String(url)).pathname);
      return new Response("ok");
    },
  });
  const draft = await store.createDocument({
    frontmatter: { title: "Garden", slug: "garden" },
    body: "",
  });
  const request = (suffix: string, method: string) =>
    new Request(`https://test/api/documents/${draft.document.id}${suffix}`, {
      method,
      headers: { Origin: "https://test" },
      body: JSON.stringify({
        branch: draft.branch,
        expectedHeadSha: draft.headSha,
        document: draft.document,
      }),
    });
  const saved = await (await app.api({ request: request("", "PUT"), cache })).json();
  expect(paths).toEqual([]);
  draft.headSha = saved.headSha;
  expect((await app.api({ request: request("/publish", "POST"), cache })).ok).toBe(true);
  expect(paths).toContain("/posts/garden");
  expect(paths).toContain("/");
});
