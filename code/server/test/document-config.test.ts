import { expect, test } from "bun:test";
import { configuredCollection, defineDocumentConfig } from "../src/document-config.ts";
import { createDocumentStore, type DocumentDraft } from "../src/document-store.ts";
import { fixture } from "./forge-fixture.ts";

const configuration = {
  repository: {
    provider: "github",
    owner: "writer",
    name: "documents",
    publishedBranch: "published",
  },
  collections: {
    posts: {
      directory: "content/posts",
      filename: "{createdAt}-{slug}",
      draftBranch: "drafts/{collection}/{cycle}/{id}",
      schema: {
        type: "object",
        required: ["slug"],
        properties: { slug: { type: "string", pattern: "^[a-z-]+$" } },
        additionalProperties: false,
      },
    },
  },
};
const selection = (draft: DocumentDraft) => ({
  id: draft.document.id,
  branch: draft.branch!,
  expectedHeadSha: draft.headSha,
});

test("JSON configuration drives nested storage, custom branches and the complete publication lifecycle", async () => {
  const config = defineDocumentConfig(JSON.parse(JSON.stringify(configuration)));
  const f = fixture();
  f.branches.set("published", "root");
  const store = createDocumentStore({
    ...configuredCollection(config, "posts"),
    forge: f.forge,
    author: { name: "Writer", email: "writer@example.test" },
  });
  await expect(
    store.createDocument({ frontmatter: { slug: 123 }, body: "invalid" }),
  ).rejects.toThrow();
  expect(f.commits.size).toBe(1);
  const draft = await store.createDocument({ frontmatter: { slug: "first-post" }, body: "Hello" });
  expect(draft.branch).toBe(`drafts/posts/${draft.document.id}/${draft.document.id}`);
  const folder = `content/posts/${draft.document.createdAt}-first-post`;
  expect(f.commits.get(draft.headSha)!.files[`${folder}/index.md`]).toContain("Hello");
  expect((await store.listDocuments()).map((value) => value.document.id)).toEqual([
    draft.document.id,
  ]);
  await expect(
    store.getDraft(draft.document.id, `quiescent/posts/${draft.document.id}/${draft.document.id}`),
  ).rejects.toThrow("Invalid draft");
  const published = await store.publish(selection(draft));
  expect(f.branches.get("main")).toBe("root");
  expect(f.branches.get("published")).toBe(published.publishedSha);
  const editing = await store.getDraft(draft.document.id);
  const saved = await store.saveDraft({
    ...selection(editing),
    document: { frontmatter: { slug: "renamed-post" }, body: "Updated" },
  });
  expect(f.commits.get(saved.headSha)!.files[`${folder}/index.md`]).toBeUndefined();
  await store.publish(selection(saved));
  const visible = (await store.listPublished())[0]!;
  expect(visible.document.body).toBe("Updated");
  await store.deleteDocument({ id: draft.document.id, expectedHeadSha: visible.headSha });
  expect(await store.listPublished()).toEqual([]);
});

test("configuration rejects typos, unsafe paths, overlapping collections and invalid branch templates", () => {
  expect(() => defineDocumentConfig({ ...configuration, typo: true })).toThrow();
  for (const directory of [
    "../posts",
    "/posts",
    "posts/../recipes",
    "posts//nested",
    "posts/.git",
  ]) {
    expect(() =>
      defineDocumentConfig({
        ...configuration,
        collections: { posts: { schema: true, directory } },
      }),
    ).toThrow();
  }
  for (const draftBranch of [
    "drafts/{id}",
    "drafts/{slug}/{id}/{cycle}",
    "drafts/{id}/{id}/{cycle}",
    "drafts/../{id}/{cycle}",
  ]) {
    expect(() =>
      defineDocumentConfig({
        ...configuration,
        collections: { posts: { schema: true, draftBranch } },
      }),
    ).toThrow();
  }
  expect(() =>
    defineDocumentConfig({
      ...configuration,
      collections: {
        posts: { schema: true, directory: "content" },
        recipes: { schema: true, directory: "content/recipes" },
      },
    }),
  ).toThrow("overlap");
  expect(() => configuredCollection(defineDocumentConfig(configuration), "missing")).toThrow(
    "Unknown collection",
  );
});

test("omitted naming options retain UUID paths and the original branch convention", async () => {
  const config = defineDocumentConfig({
    repository: configuration.repository,
    collections: { notes: { schema: true } },
  });
  const f = fixture();
  f.branches.set("published", "root");
  const store = createDocumentStore({
    ...configuredCollection(config, "notes"),
    forge: f.forge,
    author: { name: "Writer", email: "writer@example.test" },
  });
  const draft = await store.createDocument({ frontmatter: {}, body: "Note" });
  expect(draft.branch).toBe(`quiescent/notes/${draft.document.id}/${draft.document.id}`);
  expect(f.commits.get(draft.headSha)!.files[`notes/${draft.document.id}/index.md`]).toContain(
    "Note",
  );
});

test("collection indexes require declared scalar properties and reject arrays, unknown fields and unsafe names", () => {
  const indexed = {
    ...configuration,
    collections: { posts: { ...configuration.collections.posts, indexes: ["slug"] } },
  };
  expect(configuredCollection(defineDocumentConfig(indexed), "posts").indexes).toEqual(["slug"]);
  for (const indexes of [["unknown"], ["slug", "slug"], ["slug); DROP TABLE documents;--"]])
    expect(() =>
      defineDocumentConfig({
        ...indexed,
        collections: { posts: { ...indexed.collections.posts, indexes } },
      }),
    ).toThrow();
  expect(() =>
    defineDocumentConfig({
      ...indexed,
      collections: {
        posts: {
          ...indexed.collections.posts,
          schema: {
            type: "object",
            properties: { slug: { type: "array", items: { type: "string" } } },
          },
        },
      },
    }),
  ).toThrow("scalar");
});
