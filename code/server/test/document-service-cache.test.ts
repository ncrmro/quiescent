import { expect, test } from "bun:test";
import { memoryDocumentCache } from "../src/document-cache.ts";
import { createDocumentService } from "../src/document-service.ts";
import { localR2Media } from "../src/media.ts";
import { fixture } from "./forge-fixture.ts";

test("service create/save/publish/open/delete write through while public listing stays Git-authoritative", async () => {
  const f = fixture();
  let reads = 0;
  const service = createDocumentService({
    collection: "posts",
    schema: true,
    author: { name: "Writer", email: "writer@example.test" },
    forge: {
      ...f.forge,
      async getBranchSha(branch) {
        reads++;
        return f.forge.getBranchSha(branch);
      },
    },
    cache: { storage: memoryDocumentCache(), key: "repo/main/posts/schema" },
    references: () => [],
    media: localR2Media({
      async get() {
        return null;
      },
      async put() {},
    }),
    lfs: {
      async upload() {
        throw new Error("unused");
      },
      async download() {
        throw new Error("unused");
      },
    },
  });
  expect(await service.listDocuments()).toEqual([]);
  const created = await service.createDocument({
    frontmatter: { title: "First" },
    body: "First body",
  });
  let before = reads;
  expect((await service.listDocuments())[0]).toEqual(created);
  expect(reads).toBe(before);
  expect(await service.listPublished()).toEqual([]);
  const saved = await service.saveDraft({
    id: created.document.id,
    branch: created.branch!,
    expectedHeadSha: created.headSha,
    document: { frontmatter: { title: "Changed" }, body: "Changed body" },
  });
  before = reads;
  expect((await service.listDocuments())[0]?.document.body).toBe("Changed body");
  expect(reads).toBe(before);
  const published = await service.publish({
    id: saved.document.id,
    branch: saved.branch!,
    expectedHeadSha: saved.headSha,
  });
  before = reads;
  expect((await service.listDocuments())[0]?.state).toBe("published");
  expect(reads).toBe(before);
  expect((await service.listPublished())[0]?.document).toEqual(published.document);
  const editing = await service.getDraft(created.document.id);
  before = reads;
  expect((await service.listDocuments())[0]?.state).toBe("unpublished-changes");
  expect(reads).toBe(before);
  await expect(
    service.saveDraft({
      id: editing.document.id,
      branch: editing.branch!,
      expectedHeadSha: "stale",
      document: editing.document,
    }),
  ).rejects.toThrow("newer changes");
  expect((await service.listDocuments())[0]?.headSha).toBe(editing.headSha);
  await service.deleteDocument({
    id: editing.document.id,
    branch: editing.branch,
    expectedHeadSha: editing.headSha,
  });
  before = reads;
  expect(await service.listDocuments()).toEqual([]);
  expect(reads).toBe(before);
  expect(await service.listPublished()).toEqual([]);
});
