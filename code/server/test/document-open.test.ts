import { expect, test } from "bun:test";
import { createDocumentHandler } from "../src/document-http.ts";
import { createDocumentStore } from "../src/document-store.ts";
import { localR2Media } from "../src/media.ts";
import { fixture } from "./forge-fixture.ts";

async function setup() {
  const backend = fixture();
  const store = createDocumentStore({
    forge: backend.forge,
    author: { name: "Writer", email: "writer@example.test" },
    collection: "posts",
    schema: true,
  });
  const draft = await store.createDocument({
    frontmatter: { title: "Original" },
    body: "Public body",
  });
  await store.publish({
    id: draft.document.id,
    branch: draft.branch!,
    expectedHeadSha: draft.headSha,
  });
  return { ...backend, store, id: draft.document.id };
}
test("repeated published editor GETs do not create commits or branches; first PUT keeps public content", async () => {
  const { store, commits, branches, id } = await setup();
  const handler = createDocumentHandler({
    store,
    authorize: () => true,
    media: localR2Media({ get: async () => null, put: async () => {} }),
  });
  const count = commits.size;
  const branchCount = branches.size;
  for (let i = 0; i < 3; i++) {
    const response = await handler(new Request(`https://test/api/documents/${id}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      branch: null,
      state: "published",
      directory: `posts/${id}`,
    });
  }
  for (const method of ["GET", "HEAD"]) {
    const response = await handler(
      new Request(`https://test/api/documents/${id}/uploads`, { method }),
    );
    expect(response.status).toBe(404);
  }
  expect(commits.size).toBe(count);
  expect(branches.size).toBe(branchCount);
  const opened = await store.openDocument(id);
  const input = {
    branch: null,
    expectedHeadSha: opened.headSha,
    document: { ...opened.document, body: "Private change" },
  };
  const response = await handler(
    new Request(`https://test/api/documents/${id}`, {
      method: "PUT",
      headers: { Origin: "https://test" },
      body: JSON.stringify(input),
    }),
  );
  expect(response.status).toBe(200);
  const saved = await response.json();
  expect(saved).toMatchObject({
    state: "unpublished-changes",
    document: { body: "Private change" },
  });
  expect(saved.branch).toBeString();
  expect(branches.size).toBe(branchCount + 1);
  expect((await store.getPublished(id))?.document.body).toBe("Public body");
  expect(await store.openDocument(id)).toEqual(saved);
  const after = commits.size;
  expect(await store.saveDocument({ id, ...input })).toEqual(saved);
  expect(commits.size).toBe(after);
  expect(saved.document).not.toHaveProperty("storageDirectory");
  expect(saved.document.frontmatter).not.toHaveProperty("storageDirectory");
});
test("stale publication or competing first-save changes conflict without creating another branch", async () => {
  const { store, forge, commits, branches, id } = await setup();
  const opened = await store.openDocument(id);
  const path = `posts/${id}/index.md`;
  const original = (await forge.getFile(path, opened.headSha))!;
  await forge.commitFiles({
    branch: "main",
    expectedHeadSha: opened.headSha,
    message: "External edit",
    files: [{ path, content: original.content.replace("Public body", "External public body") }],
  });
  const count = commits.size;
  const branchCount = branches.size;
  await expect(
    store.saveDocument({
      id,
      branch: null,
      expectedHeadSha: opened.headSha,
      document: { ...opened.document, body: "Stale edit" },
    }),
  ).rejects.toMatchObject({ code: "conflict" });
  expect(commits.size).toBe(count);
  expect(branches.size).toBe(branchCount);
  const fresh = await store.openDocument(id);
  await store.saveDocument({
    id,
    branch: null,
    expectedHeadSha: fresh.headSha,
    document: { ...fresh.document, body: "First tab" },
  });
  const after = commits.size;
  await expect(
    store.saveDocument({
      id,
      branch: null,
      expectedHeadSha: fresh.headSha,
      document: { ...fresh.document, body: "Second tab" },
    }),
  ).rejects.toMatchObject({ code: "conflict" });
  expect(commits.size).toBe(after);
  expect((await store.openDocument(id)).document.body).toBe("First tab");
});
test("an explicit unchanged first save starts an upload-ready cycle but opening remains read-only", async () => {
  const { store, commits, id } = await setup();
  const opened = await store.openDocument(id);
  const saved = await store.saveDocument({
    id,
    branch: null,
    expectedHeadSha: opened.headSha,
    document: opened.document,
  });
  expect(saved.branch).toBeString();
  expect(saved.document).toEqual(opened.document);
  const count = commits.size;
  expect(await store.openDocument(id)).toEqual(saved);
  expect(commits.size).toBe(count);
});
