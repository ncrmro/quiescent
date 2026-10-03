import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import {
  createDocumentListCache,
  type DocumentCacheStorage,
  documentCacheView,
} from "../src/document-cache.ts";
import { sqliteDocumentCache } from "../src/document-cache-sqlite.ts";
import type { JSONSchema } from "../src/document-codec.ts";
import { createDocumentService } from "../src/document-service.ts";
import { localR2Media } from "../src/media.ts";
import { fixture } from "./forge-fixture.ts";

const schema = {
  type: "object",
  properties: { title: { type: "string" }, slug: { type: "string" }, minutes: { type: "integer" } },
  required: ["title", "slug", "minutes"],
  additionalProperties: false,
} satisfies JSONSchema;
function setup(
  storage: DocumentCacheStorage,
  f: ReturnType<typeof fixture>,
  collection = "posts",
  offline = false,
) {
  return createDocumentService({
    collection,
    schema,
    indexes: ["slug", "minutes"],
    author: { name: "Writer", email: "writer@example.test" },
    cache: { storage, key: "owner/repository/main/config" },
    forge: offline
      ? new Proxy(f.forge, {
          get(target, property) {
            const value = Reflect.get(target, property);
            if (typeof value === "function")
              return () => {
                throw new Error(`Warm read called Git: ${String(property)}`);
              };
            return value;
          },
        })
      : f.forge,
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
}
test("persistent SQLite reopens public, article, admin, and editor reads without Git; collections share rows", async () => {
  const dir = await mkdtemp(join(tmpdir(), "quiescent-sqlite-"));
  const url = `file:${join(dir, "cache.sqlite")}`;
  let storage = sqliteDocumentCache({ url });
  const f = fixture();
  try {
    const service = setup(storage, f);
    const draft = await service.createDocument({
      frontmatter: { title: "Public", slug: "public", minutes: 20 },
      body: "Published body",
    });
    await service.publish({
      id: draft.document.id,
      branch: draft.branch!,
      expectedHeadSha: draft.headSha,
    });
    const published = await service.openDocument(draft.document.id);
    expect(published.branch).toBeNull();
    const editing = await service.saveDocument({
      id: published.document.id,
      branch: null,
      expectedHeadSha: published.headSha,
      document: {
        frontmatter: { title: "Private", slug: "private", minutes: 30 },
        body: "Private body",
      },
    });
    expect((await service.getPublishedBySlug("public"))?.document.body).toBe("Published body");
    expect(await service.getPublishedBySlug("private")).toBeNull();
    const recipes = setup(storage, f, "recipes");
    const recipe = await recipes.createDocument({
      frontmatter: { title: "Soup", slug: "soup", minutes: 10 },
      body: "Soup recipe",
    });
    await recipes.publish({
      id: recipe.document.id,
      branch: recipe.branch!,
      expectedHeadSha: recipe.headSha,
    });
    await service.listDocuments();
    await recipes.listDocuments();
    storage.close();
    storage = sqliteDocumentCache({ url });
    const warm = setup(storage, f, "posts", true);
    const warmRecipes = setup(storage, f, "recipes", true);
    expect((await warm.listPublished())[0]?.document.body).toBe("Published body");
    expect((await warm.getPublished(published.document.id))?.headSha).toBe(published.headSha);
    expect((await warm.getPublishedBySlugWithStatus("public")).cache.stale).toBe(false);
    expect((await warm.listDocuments())[0]?.document.body).toBe("Private body");
    expect((await warm.openDocument(editing.document.id)).headSha).toBe(editing.headSha);
    expect(
      (
        await warmRecipes.listPublishedWithStatus({
          where: [{ field: "minutes", op: "lte", value: 15 }],
          orderBy: [{ field: "minutes", direction: "asc" }],
        })
      ).documents,
    ).toHaveLength(1);
    expect(
      (
        await warmRecipes.listPublishedWithStatus({
          where: [{ field: "minutes", op: "gt", value: 15 }],
        })
      ).documents,
    ).toHaveLength(0);
    expect(await warm.getPublishedBySlug("soup")).toBeNull();
    await expect(
      warm.listPublishedWithStatus({ where: [{ field: "body", op: "eq", value: "x" }] }),
    ).rejects.toThrow("not indexed");
    const inspect = createClient({ url });
    const counts = await inspect.execute(
      "SELECT collection, COUNT(*) AS count FROM quiescent_documents GROUP BY collection ORDER BY collection",
    );
    expect(counts.rows.map((row) => [row.collection, Number(row.count)])).toEqual([
      ["posts", 2],
      ["recipes", 1],
    ]);
    inspect.close();
  } finally {
    storage.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test("independent persistent SQLite adapters fence a delayed refresh against a completed writer", async () => {
  const dir = await mkdtemp(join(tmpdir(), "quiescent-sqlite-race-"));
  const url = `file:${join(dir, "cache.sqlite")}`;
  const first = sqliteDocumentCache({ url });
  const second = sqliteDocumentCache({ url });
  const key = documentCacheView("repo", "posts", "published");
  try {
    const f = fixture();
    const service = setup(first, f);
    const draft = await service.createDocument({
      frontmatter: { title: "Public", slug: "public", minutes: 1 },
      body: "original",
    });
    const value = { ...draft, branch: null, state: "published" as const };
    const cache = createDocumentListCache({ storage: first, key }, async () => [value]);
    await cache.read();
    const snapshot = await first.read(key);
    expect(await first.claim(key, snapshot.revision, "slow", 1, 100)).toBe(true);
    const revision = await second.beginWrite(key, 2, 100);
    const newer = { ...value, document: { ...value.document, body: "newer" } };
    await second.finishWrite(key, revision, { id: value.document.id, document: newer }, 3);
    expect(await first.complete(key, "slow", [value], 4)).toBe(false);
    expect((await second.read(key)).documents[0]?.document.body).toBe("newer");
  } finally {
    first.close();
    second.close();
    await rm(dir, { recursive: true, force: true });
  }
});
