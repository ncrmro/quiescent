import { expect, test } from "bun:test";
import { GitHubForge } from "../src/github.ts";
import { createMockFetch } from "./mock-fetch.ts";

const ref = "a".repeat(40);
function client(response: unknown) {
  const { mockFetch, requests } = createMockFetch([
    { method: "POST", url: "/graphql", response },
    {
      method: "GET",
      url: "/contents/large.md",
      response: { path: "large.md", sha: "blob", type: "file", content: btoa("complete") },
    },
  ]);
  return {
    requests,
    forge: new GitHubForge({
      kind: "github",
      owner: "writer",
      repo: "notes",
      token: "test",
      fetch: mockFetch,
    }),
  };
}
test("batch reads preserve missing-file ordering and use complete content for truncated blobs", async () => {
  const { forge } = client({
    data: {
      repository: {
        f0: null,
        f1: { __typename: "Blob", oid: "blob", text: "partial", isTruncated: true },
      },
    },
  });
  expect(
    await forge.getFiles([
      { path: "missing.md", ref },
      { path: "large.md", ref },
    ]),
  ).toEqual([null, { path: "large.md", sha: "blob", content: "complete" }]);
});
test("batch reads fail closed on GraphQL errors, missing fields, and mutable refs", async () => {
  for (const response of [
    { errors: [{ message: "denied" }], data: { repository: { f0: null } } },
    { data: { repository: {} } },
  ]) {
    await expect(client(response).forge.getFiles([{ path: "index.md", ref }])).rejects.toThrow();
  }
  const { forge, requests } = client({});
  await expect(forge.getFiles([{ path: "index.md", ref: "main" }])).rejects.toThrow("immutable");
  expect(requests).toHaveLength(0);
});

test("large batches retain input order with at most three concurrent GraphQL requests", async () => {
  let active = 0;
  let maximum = 0;
  let requests = 0;
  const forge = new GitHubForge({
    kind: "github",
    owner: "writer",
    repo: "notes",
    token: "test",
    fetch: (async (_, init) => {
      active++;
      requests++;
      maximum = Math.max(maximum, active);
      const { variables } = JSON.parse(String(init?.body));
      await new Promise((resolve) => setTimeout(resolve, variables.e0.endsWith("0.md") ? 5 : 1));
      const repository = Object.fromEntries(
        Object.entries(variables)
          .filter(([key]) => /^e\d+$/.test(key))
          .map(([key, value]) => [
            `f${key.slice(1)}`,
            { __typename: "Blob", oid: ref, text: value, isTruncated: false },
          ]),
      );
      active--;
      return Response.json({ data: { repository } });
    }) as typeof fetch,
  });
  const files = Array.from({ length: 100 }, (_, i) => ({ path: `${i}.md`, ref }));
  const result = await forge.getFiles(files);
  expect(result.map((file) => file?.content)).toEqual(files.map(({ path }) => `${ref}:${path}`));
  expect(maximum).toBe(3);
  expect(requests).toBe(4);
});
