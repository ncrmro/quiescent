import { describe, expect, test } from "bun:test";
import type { PublishingForge, CommitFilesOptions } from "@quiescent/git";
import { createPublishingService } from "../src/publishing.ts";

function fixture() {
  type Commit = { files: Record<string, string>; parents: string[] };
  const commits = new Map<string, Commit>([["root", { files: {}, parents: [] }]]);
  const branches = new Map([["main", "root"]]);
  let counter = 0;
  let loseMergeResponse = false;
  let losePrepareResponse = false;
  function resolve(ref: string) { return branches.get(ref) ?? ref; }
  function ancestor(a: string, b: string): boolean {
    return a === b || commits.get(b)!.parents.some(p => ancestor(a, p));
  }
  function add(files: Record<string, string>, parents: string[]) {
    const sha = `commit-${++counter}`;
    commits.set(sha, { files, parents });
    return sha;
  }
  const forge = {
    kind: "github",
    async getBranchSha(branch: string) { if (!branches.has(branch)) throw new Error("missing branch"); return branches.get(branch)!; },
    async createBranch(name: string, sha: string) { if (branches.has(name)) throw new Error("branch exists"); branches.set(name, sha); },
    async getFile(path: string, ref = "main") {
      const sha = resolve(ref);
      const content = commits.get(sha)!.files[path];
      return content === undefined ? null : { path, sha, content };
    },
    async listDir(path: string, ref: string) {
      return [...new Set(Object.keys(commits.get(resolve(ref))!.files).filter(p => p.startsWith(path + "/")).map(p => p.slice(path.length + 1).split("/")[0]!))].map(name => ({ name, path: `${path}/${name}`, sha: ref, type: "dir" as const }));
    },
    async commitFiles(options: CommitFilesOptions) {
      const parent = branches.get(options.branch)!;
      if (parent !== options.expectedHeadSha) throw new Error("stale");
      const files = { ...commits.get(parent)!.files };
      for (const change of options.files) files[change.path] = change.content;
      const sha = add(files, [parent]);
      branches.set(options.branch, sha);
      if (losePrepareResponse && options.message === "Prepare post publication") { losePrepareResponse = false; throw new Error("connection lost during prepare"); }
      return { sha };
    },
    async listBranches(prefix: string) { return [...branches].filter(([name]) => name.startsWith(prefix)).map(([name, sha]) => ({ name, sha })); },
    async isAncestor(a: string, b: string) { return ancestor(resolve(a), resolve(b)); },
    async compareCommits(base: string, head: string) {
      function mergeBase(candidate: string): string | undefined {
        if (ancestor(candidate, base)) return candidate;
        for (const parent of commits.get(candidate)!.parents) { const found = mergeBase(parent); if (found) return found; }
      }
      const common = mergeBase(head)!;
      const before = commits.get(common)!.files;
      const after = commits.get(head)!.files;
      return { status: "ahead", aheadBy: 1, files: [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(p => before[p] !== after[p]).map(filename => ({ filename })) };
    },
    async mergeBranch(base: string, head: string) {
      const parent = branches.get(base)!;
      const comparison = await forge.compareCommits(parent, head);
      const files = { ...commits.get(parent)!.files };
      for (const { filename } of comparison.files) files[filename] = commits.get(head)!.files[filename]!;
      const sha = add(files, [parent, head]);
      branches.set(base, sha);
      if (loseMergeResponse) { loseMergeResponse = false; throw new Error("connection lost"); }
      return { sha };
    },
  } as unknown as PublishingForge;
  return { forge, branches, commits, loseNextMergeResponse() { loseMergeResponse = true; }, loseNextPrepareResponse() { losePrepareResponse = true; }, service: () => createPublishingService({ forge, author: { name: "Writer", email: "writer@example.test" } }) };
}
async function saved(f: ReturnType<typeof fixture>, title: string) {
  const draft = await f.service().createPost();
  return f.service().saveDraft({ id: draft.post.id, branch: draft.branch!, expectedHeadSha: draft.headSha, post: { ...draft.post, title } });
}
function selection(draft: Awaited<ReturnType<typeof saved>>) { return { id: draft.post.id, branch: draft.branch!, expectedHeadSha: draft.headSha }; }

describe("Git-backed publication", () => {
  test("reopens persisted drafts and publishes one without exposing another", async () => {
    const f = fixture();
    const first = await saved(f, "Dinner with friends");
    const second = await saved(f, "Unfinished travel story");
    expect((await f.service().getDraft(first.post.id)).post.title).toBe("Dinner with friends");
    const published = await f.service().publish(selection(first));
    expect(published.post.slug).toContain("dinner-with-friends");
    expect(await f.service().getPublished(second.post.id)).toBeNull();
    expect((await f.service().listPublished()).map(p => p.post.id)).toEqual([first.post.id]);
    expect((await f.service().listPosts()).map(p => p.state).sort()).toEqual(["draft", "published"]);
    const editing = await f.service().getDraft(first.post.id);
    const revision = await f.service().saveDraft({ ...selection(editing), post: { ...editing.post, title: "A lovely dinner" } });
    expect((await f.service().getPublished(first.post.id))!.post.title).toBe("Dinner with friends");
    await f.service().publish(selection(revision));
    expect((await f.service().getPublished(first.post.id))!.post.title).toBe("A lovely dinner");
    expect((await f.service().getPublished(first.post.id))!.post.slug).toBe(published.post.slug);
  });
  test("concurrent edit opens share one cycle and preserve winner edits", async () => {
    const f = fixture();
    const initial = await saved(f, "A story to revise");
    await f.service().publish(selection(initial));
    const [first, second] = await Promise.all([f.service().getDraft(initial.post.id), f.service().getDraft(initial.post.id)]);
    expect(first.branch).toBe(second.branch);
    expect(first.headSha).toBe(second.headSha);
    const edited = await f.service().saveDraft({ ...selection(first), post: { ...first.post, title: "The winning revision" } });
    await expect(f.service().saveDraft({ ...selection(second), post: { ...second.post, title: "Stale revision" } })).rejects.toMatchObject({ code: "conflict" });
    expect((await f.service().listPosts()).filter(p => p.post.id === initial.post.id)).toHaveLength(1);
    expect((await f.service().getDraft(initial.post.id)).post.title).toBe("The winning revision");
    await f.service().publish(selection(edited));
    const next = await f.service().getDraft(initial.post.id);
    expect(next.branch).not.toBe(first.branch);
  });
  test("retries interrupted deterministic cycle initialization without another branch", async () => {
    const f = fixture();
    const initial = await saved(f, "Sunday walk");
    await f.service().publish(selection(initial));
    const commit = f.forge.commitFiles;
    let fail = true;
    f.forge.commitFiles = async options => {
      if (fail && options.message === "Save writing draft") { fail = false; throw new Error("offline before commit"); }
      return commit(options);
    };
    await expect(f.service().getDraft(initial.post.id)).rejects.toThrow("offline before commit");
    const branches = f.branches.size;
    const recovered = await f.service().getDraft(initial.post.id);
    expect(f.branches.size).toBe(branches);
    expect(recovered.state).toBe("unpublished-changes");
    const resumed = await f.service().saveDraft({ ...selection(recovered), post: { ...recovered.post, title: "Resumed writing" } });
    expect(resumed.post.title).toBe("Resumed writing");
  });
  test("lost publication response retries without a second merge", async () => {
    const f = fixture();
    const draft = await saved(f, "Weekend");
    f.loseNextMergeResponse();
    await expect(f.service().publish(selection(draft))).rejects.toThrow("connection lost");
    const count = f.commits.size;
    expect((await f.service().publish(selection(draft))).state).toBe("published");
    expect(f.commits.size).toBe(count);
    expect((await f.service().listPosts())[0]!.state).toBe("published");
  });
  test("recovers publication preparation after a lost response", async () => {
    const f = fixture();
    const draft = await saved(f, "A walk outside");
    f.loseNextPrepareResponse();
    await expect(f.service().publish(selection(draft))).rejects.toThrow("connection lost during prepare");
    expect(await f.service().getPublished(draft.post.id)).toBeNull();
    const count = f.commits.size;
    await f.service().publish(selection(draft));
    expect(f.commits.size).toBe(count + 1);
    expect((await f.service().getPublished(draft.post.id))!.post.title).toBe("A walk outside");
  });
  test("can resume a prepared draft after browser reload and retry it", async () => {
    const f = fixture();
    const draft = await saved(f, "A day at the beach");
    f.loseNextPrepareResponse();
    await expect(f.service().publish(selection(draft))).rejects.toThrow();
    const reopened = await f.service().getDraft(draft.post.id);
    expect((await f.service().publish(selection(reopened))).state).toBe("published");
    const count = f.commits.size;
    expect((await f.service().publish(selection(reopened))).state).toBe("published");
    expect(f.commits.size).toBe(count);
  });
  test("rejects document ID tampering and cross-post draft selection", async () => {
    const f = fixture();
    const first = await saved(f, "First");
    const second = await saved(f, "Second");
    await expect(f.service().saveDraft({ ...selection(first), post: second.post })).rejects.toMatchObject({ code: "invalid" });
    await expect(f.service().publish({ ...selection(first), id: second.post.id })).rejects.toMatchObject({ code: "invalid" });
    expect((await f.service().getDraft(first.post.id)).post.title).toBe("First");
  });
  test("rejects stale tabs and never trusts publication fields from a save", async () => {
    const f = fixture();
    const draft = await saved(f, "First");
    const newer = await f.service().saveDraft({ ...selection(draft), post: { ...draft.post, title: "Newer", slug: "overwrite", publishedAt: "fake" } });
    expect(newer.post.slug).toBeNull();
    expect(newer.post.publishedAt).toBeUndefined();
    await expect(f.service().saveDraft({ ...selection(draft), post: draft.post })).rejects.toMatchObject({ code: "conflict" });
    await expect(f.service().publish(selection(draft))).rejects.toMatchObject({ code: "conflict" });
    expect((await f.service().getDraft(draft.post.id)).post.title).toBe("Newer");
  });
  test("merge failure preserves draft and previous publication", async () => {
    const f = fixture();
    const initial = await saved(f, "Original article");
    await f.service().publish(selection(initial));
    const editing = await f.service().getDraft(initial.post.id);
    const revised = await f.service().saveDraft({ ...selection(editing), post: { ...editing.post, title: "Revised article" } });
    const merge = f.forge.mergeBranch;
    f.forge.mergeBranch = async () => { throw new Error("merge conflict"); };
    await expect(f.service().publish(selection(revised))).rejects.toThrow("merge conflict");
    expect((await f.service().getPublished(initial.post.id))!.post.title).toBe("Original article");
    expect((await f.service().getDraft(initial.post.id)).post.title).toBe("Revised article");
    f.forge.mergeBranch = merge;
    await f.service().publish(selection(revised));
    expect((await f.service().getPublished(initial.post.id))!.post.title).toBe("Revised article");
  });
  test("newer edits during publication stay private and survive retries", async () => {
    const f = fixture();
    const draft = await saved(f, "Publish this version");
    const merge = f.forge.mergeBranch;
    f.forge.mergeBranch = async (base, head) => {
      const newer = await f.service().getDraft(draft.post.id, draft.branch!);
      await f.service().saveDraft({ ...selection(newer), post: { ...newer.post, title: "Private later changes" } });
      return merge(base, head);
    };
    await f.service().publish(selection(draft));
    const count = f.commits.size;
    await f.service().publish(selection(draft));
    expect(f.commits.size).toBe(count);
    expect((await f.service().getPublished(draft.post.id))!.post.title).toBe("Publish this version");
    expect((await f.service().getDraft(draft.post.id)).post.title).toBe("Private later changes");
  });
  test("rejects unrelated changes and invalid media before publication", async () => {
    const f = fixture();
    const draft = await saved(f, "Weekend");
    const changed = await f.forge.commitFiles({ branch: draft.branch!, expectedHeadSha: draft.headSha, message: "unexpected", files: [{ path: "config.json", content: "bad" }] });
    await expect(f.service().publish({ ...selection(draft), expectedHeadSha: changed.sha })).rejects.toMatchObject({ code: "invalid" });
    const clean = await saved(f, "Photo story");
    const service = createPublishingService({ forge: f.forge, author: { name: "Writer", email: "test@example.test" }, verifyMedia() { throw new Error("Upload incomplete"); } });
    await expect(service.publish(selection(clean))).rejects.toThrow("Upload incomplete");
    expect(await service.getPublished(clean.post.id)).toBeNull();
  });
});

describe('deletion',()=>{
  test('deletes a published revision and prevents stale branches resurrecting it',async()=>{
    const f=fixture();const draft=await saved(f,'A temporary story');
    await f.service().publish(selection(draft));
    const edit=await f.service().getDraft(draft.post.id);
    const result=await f.service().deletePost({...selection(edit)});
    expect(result.deleted).toBe(true);
    expect(await f.service().getPublished(draft.post.id)).toBeNull();
    expect(await f.service().listPosts()).toEqual([]);
    await expect(f.service().saveDraft({...selection(edit),post:edit.post})).rejects.toMatchObject({code:'not_found'});
    await expect(f.service().publish(selection(edit))).rejects.toMatchObject({code:'not_found'});
    expect((await f.service().deletePost(selection(edit))).deleted).toBe(true);
  });
  test('rejects stale deletion and removes an unpublished draft without exposing it',async()=>{
    const f=fixture();const draft=await saved(f,'Unfinished');
    const updated=await f.service().saveDraft({...selection(draft),post:{...draft.post,title:'Newer'}});
    await expect(f.service().deletePost(selection(draft))).rejects.toMatchObject({code:'conflict'});
    await f.service().deletePost(selection(updated));
    expect(await f.service().listPosts()).toEqual([]);
    expect(await f.service().listPublished()).toEqual([]);
  });
});
