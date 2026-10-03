import { describe, expect, test } from "bun:test";
import {
  ConflictError,
  createForge,
  ForgeError,
  GitHubForge,
  requirePublishingForge,
} from "../src/index.ts";
import { createMockFetch, type Route } from "./mock-fetch.ts";

const head = "a".repeat(40);
const base = "b".repeat(40);
function forge(routes: Route[]) {
  const { mockFetch, requests } = createMockFetch(routes);
  return {
    requests,
    client: new GitHubForge({
      kind: "github",
      owner: "writer",
      repo: "blog",
      token: "test",
      fetch: mockFetch,
    }),
  };
}

describe("GitHub publishing", () => {
  test("lists all pages before filtering draft branches", async () => {
    const { client, requests } = forge([
      {
        method: "GET",
        url: "&page=1",
        response: Array.from({ length: 100 }, (_, i) => ({
          name: `other/${i}`,
          commit: { sha: base },
        })),
      },
      { method: "GET", url: "&page=2", response: [{ name: "draft/post", commit: { sha: head } }] },
    ]);
    expect(await client.listBranches("draft/")).toEqual([{ name: "draft/post", sha: head }]);
    expect(requests).toHaveLength(2);
  });

  test("compares immutable revisions and preserves rename sources for scope validation", async () => {
    const { client, requests } = forge([
      {
        method: "GET",
        url: "/compare/",
        response: {
          status: "diverged",
          ahead_by: 2,
          files: [
            { filename: "posts/one/document.json", previous_filename: "posts/two/document.json" },
          ],
        },
      },
    ]);
    expect(await client.compareCommits(base, head)).toEqual({
      status: "diverged",
      aheadBy: 2,
      files: [{ filename: "posts/one/document.json", previousFilename: "posts/two/document.json" }],
    });
    expect(requests[0]?.url).toContain(`${base}...${head}?per_page=1&page=1`);
  });

  test("reader loads the captured revision instead of a moving branch", async () => {
    const { client, requests } = forge([
      {
        method: "GET",
        url: "/contents/posts/one/document.json",
        response: {
          path: "posts/one/document.json",
          type: "file",
          sha: "blob",
          content: btoa("{}"),
        },
      },
    ]);
    expect((await client.getFile("posts/one/document.json", head))?.content).toBe("{}");
    expect(requests[0]?.url).toEndWith(`?ref=${head}`);
  });

  test("refuses potentially truncated publication scopes", async () => {
    for (const files of [
      undefined,
      Array.from({ length: 300 }, (_, i) => ({ filename: `posts/one/${i}` })),
    ]) {
      const { client } = forge([
        { method: "GET", url: "/compare/", response: { status: "ahead", ahead_by: 1, files } },
      ]);
      await expect(client.compareCommits(base, head)).rejects.toThrow(
        "Cannot verify complete publication scope",
      );
    }
  });

  test("ancestry does not depend on the comparison file limit", async () => {
    for (const [status, expected] of [
      ["ahead", true],
      ["identical", true],
      ["behind", false],
      ["diverged", false],
    ] as const) {
      const { client } = forge([
        { method: "GET", url: "/compare/", response: { status, ahead_by: 0 } },
      ]);
      expect(await client.isAncestor(base, head)).toBe(expected);
    }
  });

  test("merges the captured commit rather than a moving branch", async () => {
    const { client, requests } = forge([
      {
        method: "POST",
        url: "/merges",
        status: 201,
        response: { sha: base, html_url: "https://github.com/commit" },
      },
    ]);
    expect(await client.mergeBranch("main", head)).toEqual({
      sha: base,
      url: "https://github.com/commit",
    });
    expect(requests[0]?.body).toEqual({ base: "main", head });
    await expect(client.mergeBranch("main", "draft/post")).rejects.toThrow("immutable commit SHA");
    expect(requests).toHaveLength(1);
  });

  test("an already merged retry resolves current published revision without parsing an empty body", async () => {
    const { client } = forge([
      { method: "POST", url: "/merges", status: 204, response: null },
      { method: "GET", url: "/git/ref/heads/main", response: { object: { sha: base } } },
    ]);
    expect(await client.mergeBranch("main", head)).toEqual({ sha: base });
  });

  test("merge conflicts propagate and never attempt a forced ref update", async () => {
    const { client, requests } = forge([
      { method: "POST", url: "/merges", status: 409, response: { message: "Merge conflict" } },
    ]);
    await expect(client.mergeBranch("main", head)).rejects.toBeInstanceOf(ForgeError);
    expect(requests).toHaveLength(1);
  });

  test("a branch advancing during save produces a recoverable conflict", async () => {
    let reads = 0;
    const { mockFetch, requests } = createMockFetch([
      { method: "GET", url: "/git/commits/", response: { tree: { sha: "tree" } } },
      { method: "POST", url: "/git/trees", response: { sha: "tree2" } },
      { method: "POST", url: "/git/commits", response: { sha: head } },
      {
        method: "PATCH",
        url: "/git/refs/",
        status: 422,
        response: { message: "Not a fast forward" },
      },
    ]);
    const client = new GitHubForge({
      kind: "github",
      owner: "writer",
      repo: "blog",
      token: "test",
      fetch: (async (input, init) => {
        if (String(input).includes("/git/ref/heads/"))
          return Response.json({ object: { sha: ++reads === 1 ? base : "c".repeat(40) } });
        return mockFetch(input, init);
      }) as typeof fetch,
    });
    await expect(
      client.commitFiles({
        branch: "draft/post",
        message: "Save",
        files: [{ path: "posts/one/document.json", content: "{}" }],
        expectedHeadSha: base,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(requests.at(-1)?.body).toEqual({ sha: head, force: false });
  });

  test("unsupported forge capabilities fail explicitly without changing legacy clients", () => {
    const github = forge([]).client;
    expect(requirePublishingForge(github)).toBe(github);
    const gitea = createForge({
      kind: "gitea",
      baseUrl: "https://git.example.com",
      owner: "writer",
      repo: "blog",
      token: "test",
    });
    expect(() => requirePublishingForge(gitea)).toThrow("Publishing is not supported");
  });
});

test("Markdown replaces a legacy file in one GitHub tree and one guarded commit", async () => {
  const { client, requests } = forge([
    { method: "GET", url: "/git/ref/heads/", response: { object: { sha: base } } },
    { method: "GET", url: "/git/commits/", response: { tree: { sha: "tree" } } },
    { method: "POST", url: "/git/trees", response: { sha: "new-tree" } },
    { method: "POST", url: "/git/commits", response: { sha: head } },
    { method: "PATCH", url: "/git/refs/", response: { object: { sha: head } } },
  ]);
  await client.commitFiles({
    branch: "draft",
    expectedHeadSha: base,
    message: "Save",
    files: [
      { path: "index.md", content: "---\ntitle: Lunch\n---\nBody" },
      { path: "post.json", content: null },
    ],
  });
  const tree = requests.find((r) => r.method === "POST" && r.url.endsWith("/git/trees"))!.body as {
    tree: unknown[];
  };
  expect(tree.tree).toEqual([
    { path: "index.md", mode: "100644", type: "blob", content: "---\ntitle: Lunch\n---\nBody" },
    { path: "post.json", mode: "100644", type: "blob", sha: null },
  ]);
  expect(
    requests.filter((r) => r.method === "POST" && r.url.endsWith("/git/commits")),
  ).toHaveLength(1);
});
