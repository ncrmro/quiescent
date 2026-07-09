import { describe, expect, test } from "bun:test";
import { GiteaForge, resolveGiteaBaseUrl } from "../src/gitea.ts";
import { decodeBase64, encodeBase64 } from "../src/base64.ts";
import { createMockFetch, type Route } from "./mock-fetch.ts";

function forge(routes: Route[]) {
  const { mockFetch, requests } = createMockFetch(routes);
  const client = new GiteaForge({
    kind: "codeberg",
    owner: "ncrmro",
    repo: "notes",
    token: "cb_test",
    fetch: mockFetch,
  });
  return { client, requests };
}

describe("resolveGiteaBaseUrl", () => {
  test("codeberg defaults, gitea requires baseUrl", () => {
    expect(resolveGiteaBaseUrl({ kind: "codeberg" })).toBe("https://codeberg.org");
    expect(resolveGiteaBaseUrl({ kind: "forgejo", baseUrl: "https://fj.example/" })).toBe("https://fj.example");
    expect(() => resolveGiteaBaseUrl({ kind: "gitea" })).toThrow();
  });
});

describe("GiteaForge", () => {
  test("uses codeberg api base", async () => {
    const { client, requests } = forge([
      { method: "GET", url: "/user", response: { id: 2, login: "ncrmro" } },
    ]);
    await client.getUser();
    expect(requests[0]?.url).toBe("https://codeberg.org/api/v1/user");
  });

  test("commitFiles batches create and update operations with blob shas", async () => {
    const { client, requests } = forge([
      { method: "GET", url: "/branches/main", response: { commit: { id: "head1" } } },
      {
        method: "GET",
        url: "/contents/existing.md",
        response: { path: "existing.md", name: "existing.md", type: "file", sha: "blob1", size: 1, content: encodeBase64("old") },
      },
      {
        method: "POST",
        url: "/contents",
        response: { commit: { sha: "commit1", html_url: "http://c" } },
      },
    ]);
    const result = await client.commitFiles({
      branch: "main",
      message: "edit",
      files: [
        { path: "existing.md", content: "new" },
        { path: "brand-new.md", content: "fresh" },
      ],
    });
    expect(result).toEqual({ sha: "commit1", url: "http://c" });

    const batch = requests.find((r) => r.method === "POST" && r.url.endsWith("/contents"));
    const body = batch?.body as { branch: string; files: Array<Record<string, string>> };
    expect(body.branch).toBe("main");
    expect(body.files).toEqual([
      { operation: "update", path: "existing.md", content: encodeBase64("new"), sha: "blob1" },
      { operation: "create", path: "brand-new.md", content: encodeBase64("fresh") },
    ]);
  });

  test("createBranch uses gitea branch endpoint", async () => {
    const { client, requests } = forge([
      { method: "POST", url: "/branches", response: {} },
    ]);
    await client.createBranch("suggest-1", "head1");
    expect(requests[0]?.body).toEqual({ new_branch_name: "suggest-1", old_ref_name: "head1" });
  });

  test("resetBranch deletes then recreates the branch", async () => {
    const { client, requests } = forge([
      { method: "DELETE", url: "/branches/quiescent/ncrmro", response: {} },
      { method: "POST", url: "/branches", response: {} },
    ]);
    await client.resetBranch("quiescent/ncrmro", "base1");
    expect(requests.map((r) => r.method)).toEqual(["DELETE", "POST"]);
    expect(requests[1]?.body).toEqual({ new_branch_name: "quiescent/ncrmro", old_ref_name: "base1" });
  });

  test("findOpenPullRequest matches head ref, owner, and base", async () => {
    const pulls = [
      { number: 1, html_url: "http://pr1", base: { ref: "main" }, head: { ref: "other" } },
      {
        number: 2,
        html_url: "http://pr2",
        base: { ref: "main" },
        head: { ref: "quiescent/ncrmro", repo: { owner: { login: "ncrmro" } } },
      },
    ];
    const { client } = forge([{ method: "GET", url: "/pulls?state=open", response: pulls }]);
    expect(await client.findOpenPullRequest("quiescent/ncrmro", "main")).toEqual({
      number: 2,
      url: "http://pr2",
    });
    expect(await client.findOpenPullRequest("someone-else:quiescent/ncrmro", "main")).toBeNull();
    expect(await client.findOpenPullRequest("quiescent/ncrmro", "develop")).toBeNull();
  });
});

describe("base64", () => {
  test("round-trips unicode", () => {
    const text = "héllo wörld — 日本語 🎉";
    expect(decodeBase64(encodeBase64(text))).toBe(text);
  });
});
