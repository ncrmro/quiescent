import { describe, expect, test } from "bun:test";
import { createDocumentStore } from "../src/document-store.ts";

import { fixture } from "./forge-fixture.ts";

async function saved(f: ReturnType<typeof fixture>, title: string) {
  const draft = await f
    .service()
    .createDocument({ frontmatter: { title: "", slug: "draft" }, body: "" });
  return f.service().saveDraft({
    id: draft.document.id,
    branch: draft.branch!,
    expectedHeadSha: draft.headSha,
    document: {
      ...draft.document,
      frontmatter: { title, slug: title.toLowerCase().replaceAll(" ", "-") },
    },
  });
}
function selection(draft: Awaited<ReturnType<typeof saved>>) {
  return { id: draft.document.id, branch: draft.branch!, expectedHeadSha: draft.headSha };
}

describe("Git-backed publication", () => {
  test("reopens persisted drafts and publishes one without exposing another", async () => {
    const f = fixture();
    const first = await saved(f, "Dinner with friends");
    const second = await saved(f, "Unfinished travel story");
    expect((await f.service().getDraft(first.document.id)).document.frontmatter.title).toBe(
      "Dinner with friends",
    );
    const published = await f.service().publish(selection(first));
    expect(published.document.frontmatter.slug).toContain("dinner-with-friends");
    expect(await f.service().getPublished(second.document.id)).toBeNull();
    expect((await f.service().listPublished()).map((p) => p.document.id)).toEqual([
      first.document.id,
    ]);
    expect((await f.service().listDocuments()).map((p) => p.state).sort()).toEqual([
      "draft",
      "published",
    ]);
    const editing = await f.service().getDraft(first.document.id);
    const revision = await f.service().saveDraft({
      ...selection(editing),
      document: {
        ...editing.document,
        frontmatter: { ...editing.document.frontmatter, title: "A lovely dinner" },
      },
    });
    expect((await f.service().getPublished(first.document.id))!.document.frontmatter.title).toBe(
      "Dinner with friends",
    );
    await f.service().publish(selection(revision));
    expect((await f.service().getPublished(first.document.id))!.document.frontmatter.title).toBe(
      "A lovely dinner",
    );
    expect((await f.service().getPublished(first.document.id))!.document.frontmatter.slug).toBe(
      published.document.frontmatter.slug,
    );
  });
  test("concurrent edit opens share one cycle and preserve winner edits", async () => {
    const f = fixture();
    const initial = await saved(f, "A story to revise");
    await f.service().publish(selection(initial));
    const [first, second] = await Promise.all([
      f.service().getDraft(initial.document.id),
      f.service().getDraft(initial.document.id),
    ]);
    expect(first.branch).toBe(second.branch);
    expect(first.headSha).toBe(second.headSha);
    const edited = await f.service().saveDraft({
      ...selection(first),
      document: {
        ...first.document,
        frontmatter: { ...first.document.frontmatter, title: "The winning revision" },
      },
    });
    await expect(
      f.service().saveDraft({
        ...selection(second),
        document: {
          ...second.document,
          frontmatter: { ...second.document.frontmatter, title: "Stale revision" },
        },
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(
      (await f.service().listDocuments()).filter((p) => p.document.id === initial.document.id),
    ).toHaveLength(1);
    expect((await f.service().getDraft(initial.document.id)).document.frontmatter.title).toBe(
      "The winning revision",
    );
    await f.service().publish(selection(edited));
    const next = await f.service().getDraft(initial.document.id);
    expect(next.branch).not.toBe(first.branch);
  });
  test("retries interrupted deterministic cycle initialization without another branch", async () => {
    const f = fixture();
    const initial = await saved(f, "Sunday walk");
    await f.service().publish(selection(initial));
    const commit = f.forge.commitFiles;
    let fail = true;
    f.forge.commitFiles = async (options) => {
      if (fail && options.message === "Save document draft") {
        fail = false;
        throw new Error("offline before commit");
      }
      return commit(options);
    };
    await expect(f.service().getDraft(initial.document.id)).rejects.toThrow(
      "offline before commit",
    );
    const branches = f.branches.size;
    const recovered = await f.service().getDraft(initial.document.id);
    expect(f.branches.size).toBe(branches);
    expect(recovered.state).toBe("unpublished-changes");
    const resumed = await f.service().saveDraft({
      ...selection(recovered),
      document: {
        ...recovered.document,
        frontmatter: { ...recovered.document.frontmatter, title: "Resumed writing" },
      },
    });
    expect(resumed.document.frontmatter.title).toBe("Resumed writing");
  });
  test("lost publication response retries without a second merge", async () => {
    const f = fixture();
    const draft = await saved(f, "Weekend");
    f.loseNextMergeResponse();
    await expect(f.service().publish(selection(draft))).rejects.toThrow("connection lost");
    const count = f.commits.size;
    expect((await f.service().publish(selection(draft))).state).toBe("published");
    expect(f.commits.size).toBe(count);
    expect((await f.service().listDocuments())[0]!.state).toBe("published");
  });
  test("recovers publication preparation after a lost response", async () => {
    const f = fixture();
    const draft = await saved(f, "A walk outside");
    f.loseNextPrepareResponse();
    await expect(f.service().publish(selection(draft))).rejects.toThrow(
      "connection lost during prepare",
    );
    expect(await f.service().getPublished(draft.document.id)).toBeNull();
    const count = f.commits.size;
    await f.service().publish(selection(draft));
    expect(f.commits.size).toBe(count + 1);
    expect((await f.service().getPublished(draft.document.id))!.document.frontmatter.title).toBe(
      "A walk outside",
    );
  });
  test("can resume a prepared draft after browser reload and retry it", async () => {
    const f = fixture();
    const draft = await saved(f, "A day at the beach");
    f.loseNextPrepareResponse();
    await expect(f.service().publish(selection(draft))).rejects.toThrow();
    const reopened = await f.service().getDraft(draft.document.id);
    expect((await f.service().publish(selection(reopened))).state).toBe("published");
    const count = f.commits.size;
    expect((await f.service().publish(selection(reopened))).state).toBe("published");
    expect(f.commits.size).toBe(count);
  });
  test("rejects document ID tampering and cross-document draft selection", async () => {
    const f = fixture();
    const first = await saved(f, "First");
    const second = await saved(f, "Second");
    await expect(
      f.service().saveDraft({ ...selection(first), document: second.document }),
    ).rejects.toMatchObject({ code: "invalid" });
    await expect(
      f.service().publish({ ...selection(first), id: second.document.id }),
    ).rejects.toMatchObject({ code: "invalid" });
    expect((await f.service().getDraft(first.document.id)).document.frontmatter.title).toBe(
      "First",
    );
  });
  test("allows editing slug, rejects stale tabs, and ignores forged publication state", async () => {
    const f = fixture();
    const draft = await saved(f, "First");
    const forged = {
      ...draft.document,
      createdAt: "1999-01-01",
      publishedAt: "fake",
      frontmatter: { title: "Newer", slug: "overwrite" },
    };
    const newer = await f.service().saveDraft({ ...selection(draft), document: forged });
    expect(newer.document.createdAt).toBe(draft.document.createdAt);
    expect(newer.document.frontmatter.slug).toBe("overwrite");
    expect(newer.document.publishedAt).toBeUndefined();
    await expect(
      f.service().saveDraft({ ...selection(draft), document: draft.document }),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(f.service().publish(selection(draft))).rejects.toMatchObject({ code: "conflict" });
    expect((await f.service().getDraft(draft.document.id)).document.frontmatter.title).toBe(
      "Newer",
    );
  });
  test("merge failure preserves draft and previous publication", async () => {
    const f = fixture();
    const initial = await saved(f, "Original article");
    await f.service().publish(selection(initial));
    const editing = await f.service().getDraft(initial.document.id);
    const revised = await f.service().saveDraft({
      ...selection(editing),
      document: {
        ...editing.document,
        frontmatter: { ...editing.document.frontmatter, title: "Revised article" },
      },
    });
    const merge = f.forge.mergeBranch;
    f.forge.mergeBranch = async () => {
      throw new Error("merge conflict");
    };
    await expect(f.service().publish(selection(revised))).rejects.toThrow("merge conflict");
    expect((await f.service().getPublished(initial.document.id))!.document.frontmatter.title).toBe(
      "Original article",
    );
    expect((await f.service().getDraft(initial.document.id)).document.frontmatter.title).toBe(
      "Revised article",
    );
    f.forge.mergeBranch = merge;
    await f.service().publish(selection(revised));
    expect((await f.service().getPublished(initial.document.id))!.document.frontmatter.title).toBe(
      "Revised article",
    );
  });
  test("newer edits during publication stay private and survive retries", async () => {
    const f = fixture();
    const draft = await saved(f, "Publish this version");
    const merge = f.forge.mergeBranch;
    f.forge.mergeBranch = async (base, head) => {
      const newer = await f.service().getDraft(draft.document.id, draft.branch!);
      await f.service().saveDraft({
        ...selection(newer),
        document: {
          ...newer.document,
          frontmatter: { ...newer.document.frontmatter, title: "Private later changes" },
        },
      });
      return merge(base, head);
    };
    await f.service().publish(selection(draft));
    const count = f.commits.size;
    await f.service().publish(selection(draft));
    expect(f.commits.size).toBe(count);
    expect((await f.service().getPublished(draft.document.id))!.document.frontmatter.title).toBe(
      "Publish this version",
    );
    expect((await f.service().getDraft(draft.document.id)).document.frontmatter.title).toBe(
      "Private later changes",
    );
  });
  test("rejects unrelated changes and invalid media before publication", async () => {
    const f = fixture();
    const draft = await saved(f, "Weekend");
    const changed = await f.forge.commitFiles({
      branch: draft.branch!,
      expectedHeadSha: draft.headSha,
      message: "unexpected",
      files: [{ path: "config.json", content: "bad" }],
    });
    await expect(
      f.service().publish({ ...selection(draft), expectedHeadSha: changed.sha }),
    ).rejects.toMatchObject({ code: "invalid" });
    const clean = await saved(f, "Photo story");
    const service = createDocumentStore({
      collection: "posts",
      schema: true,
      forge: f.forge,
      author: { name: "Writer", email: "test@example.test" },
      beforePublish() {
        throw new Error("Upload incomplete");
      },
    });
    await expect(service.publish(selection(clean))).rejects.toThrow("Upload incomplete");
    expect(await service.getPublished(clean.document.id)).toBeNull();
  });
});

describe("deletion", () => {
  test("deletes a published revision and prevents stale branches resurrecting it", async () => {
    const f = fixture();
    const draft = await saved(f, "A temporary story");
    await f.service().publish(selection(draft));
    const edit = await f.service().getDraft(draft.document.id);
    const result = await f.service().deleteDocument({ ...selection(edit) });
    expect(result.deleted).toBe(true);
    expect(await f.service().getPublished(draft.document.id)).toBeNull();
    expect(await f.service().listDocuments()).toEqual([]);
    await expect(
      f.service().saveDraft({ ...selection(edit), document: edit.document }),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(f.service().publish(selection(edit))).rejects.toMatchObject({ code: "not_found" });
    expect((await f.service().deleteDocument(selection(edit))).deleted).toBe(true);
  });
  test("rejects stale deletion and removes an unpublished draft without exposing it", async () => {
    const f = fixture();
    const draft = await saved(f, "Unfinished");
    const updated = await f.service().saveDraft({
      ...selection(draft),
      document: {
        ...draft.document,
        frontmatter: { ...draft.document.frontmatter, title: "Newer" },
      },
    });
    await expect(f.service().deleteDocument(selection(draft))).rejects.toMatchObject({
      code: "conflict",
    });
    await f.service().deleteDocument(selection(updated));
    expect(await f.service().listDocuments()).toEqual([]);
    expect(await f.service().listPublished()).toEqual([]);
  });
});
