import { describe, expect, test } from "bun:test";
import { ConflictError } from "../src/errors.ts";
import { GitHubForge } from "../src/github.ts";
import { encodeBase64 } from "../src/base64.ts";
import { createMockFetch, type Route } from "./mock-fetch.ts";

function forge(routes: Route[]) {
  const { mockFetch, requests } = createMockFetch(routes);
  const client = new GitHubForge({
    kind: "github",
    owner: "ncrmro",
    repo: "notes",
    token: "gho_test",
    fetch: mockFetch,
  });
  return { client, requests };
}

describe("GitHubForge", () => {
  test("getUser maps fields", async () => {
    const { client } = forge([
      {
        method: "GET",
        url: "/user",
        response: { id: 1, login: "ncrmro", name: "Nic", avatar_url: "http://a" },
      },
    ]);
    const user = await client.getUser();
    expect(user).toEqual({ id: 1, login: "ncrmro", name: "Nic", email: undefined, avatarUrl: "http://a" });
  });

  test("getRepoPermissions maps push/admin and defaults to false", async () => {
    const { client } = forge([
      { method: "GET", url: "/repos/ncrmro/notes", response: { permissions: { push: true, admin: false } } },
    ]);
    expect(await client.getRepoPermissions()).toEqual({ push: true, admin: false });

    const { client: noPerms } = forge([
      { method: "GET", url: "/repos/ncrmro/notes", response: {} },
    ]);
    expect(await noPerms.getRepoPermissions()).toEqual({ push: false, admin: false });
  });

  test("getFile decodes base64 content and returns null on 404", async () => {
    const { client } = forge([
      {
        method: "GET",
        url: "/contents/docs/note.md",
        response: { path: "docs/note.md", name: "note.md", type: "file", sha: "abc", size: 5, content: encodeBase64("héllo") },
      },
    ]);
    const file = await client.getFile("docs/note.md");
    expect(file).toEqual({ path: "docs/note.md", sha: "abc", content: "héllo" });
    expect(await client.getFile("missing.md")).toBeNull();
  });

  test("commitFiles runs blob-less tree -> commit -> ref update sequence", async () => {
    const { client, requests } = forge([
      { method: "GET", url: "/git/ref/heads/main", response: { object: { sha: "head1" } } },
      { method: "GET", url: "/git/commits/head1", response: { tree: { sha: "tree0" } } },
      { method: "POST", url: "/git/trees", response: { sha: "tree1" } },
      { method: "POST", url: "/git/commits", response: { sha: "commit1", html_url: "http://c" } },
      { method: "PATCH", url: "/git/refs/heads/main", response: { object: { sha: "commit1" } } },
    ]);
    const result = await client.commitFiles({
      branch: "main",
      message: "feat: edit note",
      files: [{ path: "docs/note.md", content: "hello" }],
      expectedHeadSha: "head1",
    });
    expect(result).toEqual({ sha: "commit1", url: "http://c" });

    const [, , tree, commit, ref] = requests;
    expect(tree?.body).toEqual({
      base_tree: "tree0",
      tree: [{ path: "docs/note.md", mode: "100644", type: "blob", content: "hello" }],
    });
    expect(commit?.body).toEqual({ message: "feat: edit note", tree: "tree1", parents: ["head1"] });
    expect(ref?.body).toEqual({ sha: "commit1" });
  });

  test("commitFiles throws ConflictError when branch moved", async () => {
    const { client } = forge([
      { method: "GET", url: "/git/ref/heads/main", response: { object: { sha: "head2" } } },
    ]);
    await expect(
      client.commitFiles({
        branch: "main",
        message: "m",
        files: [],
        expectedHeadSha: "head1",
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  test("createBranch and createPullRequest hit expected endpoints", async () => {
    const { client, requests } = forge([
      { method: "POST", url: "/git/refs", response: {} },
      { method: "POST", url: "/pulls", response: { number: 7, html_url: "http://pr" } },
    ]);
    await client.createBranch("quiescent/ncrmro/1", "head1");
    const pr = await client.createPullRequest({
      head: "quiescent/ncrmro/1",
      base: "main",
      title: "Suggest edits",
    });
    expect(pr).toEqual({ number: 7, url: "http://pr" });
    expect(requests[0]?.body).toEqual({ ref: "refs/heads/quiescent/ncrmro/1", sha: "head1" });
  });

  test("resetBranch force-updates the ref", async () => {
    const { client, requests } = forge([
      { method: "PATCH", url: "/git/refs/heads/quiescent/ncrmro", response: {} },
    ]);
    await client.resetBranch("quiescent/ncrmro", "base1");
    expect(requests[0]?.body).toEqual({ sha: "base1", force: true });
  });

  test("findOpenPullRequest owner-qualifies bare heads and returns first match or null", async () => {
    const { client, requests } = forge([
      { method: "GET", url: "/pulls?state=open", response: [{ number: 3, html_url: "http://pr3" }] },
    ]);
    expect(await client.findOpenPullRequest("quiescent/ncrmro", "main")).toEqual({
      number: 3,
      url: "http://pr3",
    });
    expect(requests[0]?.url).toContain(
      `head=${encodeURIComponent("ncrmro:quiescent/ncrmro")}&base=main`,
    );

    const { client: empty } = forge([{ method: "GET", url: "/pulls?state=open", response: [] }]);
    expect(await empty.findOpenPullRequest("fork-owner:quiescent/x", "main")).toBeNull();
  });
});
