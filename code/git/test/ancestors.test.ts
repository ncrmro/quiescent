import { expect, test } from "bun:test";
import { GitHubForge } from "../src/github.ts";
import { createMockFetch } from "./mock-fetch.ts";

const head = { branch: "main", sha: "a".repeat(40) };
const ancestors = ["b".repeat(40), "c".repeat(40), "d".repeat(40), "e".repeat(40)];
function setup(ref: unknown, errors?: unknown[]) {
  const { requests, mockFetch } = createMockFetch([
    {
      method: "POST",
      url: "/graphql",
      response: { data: { repository: { ref } }, ...(errors ? { errors } : {}) },
    },
    { method: "GET", url: `/compare/${ancestors[0]}...${head.sha}`, response: { status: "ahead" } },
    {
      method: "GET",
      url: `/compare/${ancestors[1]}...${head.sha}`,
      response: { status: "diverged" },
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
function comparison(i: number, status: string, base = head.sha, target = ancestors[i]) {
  return { status, baseTarget: { oid: base }, headTarget: { oid: target } };
}
test("GraphQL ancestry verifies comparison objects and maps the reverse comparison correctly", async () => {
  const { forge, requests } = setup(
    Object.fromEntries(
      ["BEHIND", "IDENTICAL", "AHEAD", "DIVERGED"].map((status, i) => [
        `a${i}`,
        comparison(i, status),
      ]),
    ),
  );
  expect(await forge.areAncestors(ancestors, head)).toEqual([true, true, false, false]);
  expect(requests).toHaveLength(1);
});
test("moving base or head uses the original immutable SHA pair instead of a stale comparison", async () => {
  const { forge, requests } = setup({
    a0: comparison(0, "AHEAD", "f".repeat(40)),
    a1: comparison(1, "BEHIND", head.sha, "f".repeat(40)),
  });
  expect(await forge.areAncestors(ancestors.slice(0, 2), head)).toEqual([true, false]);
  expect(requests).toHaveLength(3);
  expect(requests[1]?.url).toContain(`${ancestors[0]}...${head.sha}`);
  expect(requests[2]?.url).toContain(`${ancestors[1]}...${head.sha}`);
});
test("missing or deleted refs fall back, partial results fail closed, and empty batches make no request", async () => {
  for (const ref of [null, { a0: null }]) {
    const { forge, requests } = setup(ref);
    expect(await forge.areAncestors(ancestors.slice(0, 1), head)).toEqual([true]);
    expect(requests).toHaveLength(2);
  }
  await expect(setup({}).forge.areAncestors(ancestors.slice(0, 1), head)).rejects.toThrow(
    "Incomplete",
  );
  await expect(
    setup({ a0: comparison(0, "BEHIND") }, [{ message: "partial" }]).forge.areAncestors(
      ancestors.slice(0, 1),
      head,
    ),
  ).rejects.toThrow("batch failed");
  const { forge, requests } = setup({});
  expect(await forge.areAncestors([], head)).toEqual([]);
  await expect(forge.areAncestors(["main"], head)).rejects.toThrow("immutable");
  expect(requests).toHaveLength(0);
});
