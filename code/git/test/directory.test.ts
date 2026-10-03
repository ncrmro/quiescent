import { expect, test } from "bun:test";
import { GitHubForge } from "../src/github.ts";
import { createMockFetch } from "./mock-fetch.ts";

const ref = "a".repeat(40);
function setup(object: unknown, errors?: unknown[]) {
  const { requests, mockFetch } = createMockFetch([
    {
      method: "POST",
      url: "/graphql",
      response: { data: { repository: { object } }, ...(errors ? { errors } : {}) },
    },
    {
      method: "GET",
      url: `/contents/state/large.json?ref=${ref}`,
      response: { path: "state/large.json", type: "file", sha: "blob", content: btoa("complete") },
    },
  ]);
  return {
    requests,
    forge: new GitHubForge({
      kind: "github",
      owner: "writer",
      repo: "posts",
      token: "test",
      fetch: mockFetch,
    }),
  };
}
test("directory content preserves complete immediate files and pins fallback reads to the snapshot", async () => {
  const { forge, requests } = setup({
    __typename: "Tree",
    entries: [
      { name: "one.json", type: "blob", object: { oid: "one", text: "{}", isTruncated: false } },
      { name: "nested", type: "tree", object: { oid: "tree" } },
      {
        name: "large.json",
        type: "blob",
        object: { oid: "blob", text: "partial", isTruncated: true },
      },
    ],
  });
  expect(await forge.getDirectoryFiles("state", ref)).toEqual([
    { path: "state/one.json", sha: "one", content: "{}" },
    { path: "state/large.json", sha: "blob", content: "complete" },
  ]);
  expect(requests).toHaveLength(2);
  expect((requests[0]!.body as { variables: { expression: string } }).variables.expression).toBe(
    `${ref}:state`,
  );
});
test("absent directory is empty while incomplete or errored directory results fail closed", async () => {
  expect(await setup(null).forge.getDirectoryFiles("state", ref)).toEqual([]);
  for (const object of [
    undefined,
    { __typename: "Blob" },
    { __typename: "Tree", entries: null },
    { __typename: "Tree", entries: [{ type: "blob", name: "bad.json", object: null }] },
  ]) {
    await expect(setup(object).forge.getDirectoryFiles("state", ref)).rejects.toThrow();
  }
  await expect(
    setup(null, [{ message: "partial" }]).forge.getDirectoryFiles("state", ref),
  ).rejects.toThrow();
  await expect(setup(null).forge.getDirectoryFiles("state", "main")).rejects.toThrow("immutable");
});
