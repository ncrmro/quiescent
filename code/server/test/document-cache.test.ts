import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { DocumentDraft } from "../src/contracts.ts";
import {
  createDocumentListCache,
  type DocumentCacheDatabase,
  type DocumentCacheQuery,
  type DocumentCacheStatement,
  type DocumentCacheStorage,
  d1DocumentCache,
  documentCacheView,
  memoryDocumentCache,
} from "../src/document-cache.ts";

function sqliteCache() {
  const database = new Database(":memory:");
  database.exec(
    readFileSync(new URL("../src/documents-cache.schema.sql", import.meta.url), "utf8"),
  );
  class Statement implements DocumentCacheStatement {
    values: (string | number | null)[] = [];
    constructor(readonly sql: string) {}
    bind(...values: unknown[]) {
      this.values = values as (string | number | null)[];
      return this;
    }
    execute<T>(): DocumentCacheQuery<T> {
      const results = database.query(this.sql).all(...this.values) as T[];
      const changes = (database.query("SELECT changes() AS count").get() as { count: number })
        .count;
      return { results, meta: { changes } };
    }
    async all<T>() {
      return this.execute<T>();
    }
    async run() {
      return this.execute<Record<string, unknown>>();
    }
  }
  const adapter: DocumentCacheDatabase = {
    prepare(sql) {
      return new Statement(sql);
    },
    async batch<T>(statements: DocumentCacheStatement[]) {
      return database.transaction(() =>
        statements.map((statement) => (statement as Statement).execute<T>()),
      )();
    },
  };
  return d1DocumentCache(adapter);
}
function document(title: string, id = "one"): DocumentDraft {
  return {
    document: { id, createdAt: "2026-10-02", frontmatter: { title }, body: title },
    state: "draft",
    branch: `draft/${id}`,
    headSha: title,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
for (const [name, adapter] of Object.entries({
  memory: memoryDocumentCache,
  sqlite: sqliteCache,
})) {
  const key = documentCacheView("owner/repository/main/schema", "posts", "drafts");
  test(`${name}: first fill and warm reads avoid Git; stale reads schedule one refresh`, async () => {
    const storage = adapter();
    let now = 1;
    let calls = 0;
    const pending: Promise<unknown>[] = [];
    const cache = createDocumentListCache(
      {
        storage,
        key,
        ttlMs: 100,
        now: () => now,
        waitUntil: (work) => pending.push(work),
      },
      async () => {
        calls++;
        return [document(String(calls))];
      },
    );
    expect((await cache.read()).documents[0]?.headSha).toBe("1");
    await cache.read();
    expect(calls).toBe(1);
    now = 102;
    const stale = await cache.read();
    expect(stale.cache.stale).toBe(true);
    expect(stale.cache.refreshing).toBe(true);
    await Promise.all(pending);
    expect((await cache.read()).documents[0]?.headSha).toBe("2");
    expect(calls).toBe(2);
  });
  test(`${name}: failures retain stale documents and retry with bounded cooldown`, async () => {
    const storage = adapter();
    let now = 1;
    let calls = 0;
    const cache = createDocumentListCache(
      { storage, key, ttlMs: 100, now: () => now },
      async () => {
        if (++calls > 1) throw new Error("upstream token should not leak");
        return [document("old")];
      },
    );
    await cache.read();
    now = 102;
    const failed = await cache.read();
    expect(failed.documents).toEqual([document("old")]);
    expect(failed.cache.error).not.toContain("token");
    await cache.read();
    expect(calls).toBe(2);
    now += 30_001;
    await cache.read();
    expect(calls).toBe(3);
  });
  test(`${name}: slow rebuild cannot overwrite a completed Git mutation`, async () => {
    const storage = adapter();
    const slow = deferred<DocumentDraft[]>();
    let calls = 0;
    const cache = createDocumentListCache({ storage, key }, async () =>
      ++calls === 1 ? [document("old")] : slow.promise,
    );
    await cache.read();
    const refreshing = cache.refresh();
    // Allow the refresh to acquire its persistent fence before the mutation starts.
    while (!(await storage.read(key)).lease) await Promise.resolve();
    await cache.mutate(
      async () => document("new"),
      (value) => ({ id: "one", document: value }),
    );
    slow.resolve([document("old")]);
    await refreshing;
    expect((await cache.read()).documents).toEqual([document("new")]);
  });
  test(`${name}: concurrent writers invalidate instead of installing an older result`, async () => {
    const storage = adapter();
    const cache = createDocumentListCache({ storage, key }, async () => [document("git-latest")]);
    await cache.read();
    const older = await storage.beginWrite(key, 1, 100);
    const newer = await storage.beginWrite(key, 2, 100);
    expect(await storage.finishWrite(key, newer, { id: "one", document: document("new") }, 3)).toBe(
      true,
    );
    expect(await storage.finishWrite(key, older, { id: "one", document: document("old") }, 4)).toBe(
      false,
    );
    expect((await storage.read(key)).initialized).toBe(false);
    expect((await cache.read()).documents).toEqual([document("git-latest")]);
  });
  test(`${name}: abandoned mutation fences expire and permit an authoritative rebuild`, async () => {
    const storage = adapter();
    await storage.beginWrite(key, 1, 100);
    const before = await storage.read(key);
    expect(await storage.claim(key, before.revision, "blocked", 50, 200)).toBe(false);
    expect(await storage.claim(key, before.revision, "recovered", 101, 200)).toBe(true);
    expect(await storage.complete(key, "recovered", [document("restored")], 102)).toBe(true);
    expect((await storage.read(key)).pending).toBe(0);
  });
  test(`${name}: normal reads rebuild after an abandoned writer expires before the TTL`, async () => {
    const storage = adapter();
    let now = 1;
    let calls = 0;
    const cache = createDocumentListCache(
      { storage, key, now: () => now, ttlMs: 10000 },
      async () => [document(String(++calls))],
    );
    await cache.read();
    await storage.beginWrite(key, 2, 100);
    now = 101;
    expect((await cache.read()).documents).toEqual([document("2")]);
  });
  test(`${name}: late mutation completion revokes a refresh started after its fence expired`, async () => {
    const storage = adapter();
    const cache = createDocumentListCache({ storage, key }, async () => [document("old")]);
    await cache.read();
    const revision = await storage.beginWrite(key, 1, 100);
    expect(await storage.claim(key, revision, "new-refresh", 101, 300)).toBe(true);
    expect(
      await storage.finishWrite(key, revision, { id: "one", document: document("new") }, 102),
    ).toBe(true);
    expect(await storage.complete(key, "new-refresh", [document("old")], 103)).toBe(false);
    expect((await storage.read(key)).documents).toEqual([document("new")]);
  });
  test(`${name}: editing and publishing one active branch preserve its parallel draft`, async () => {
    const storage = adapter();
    const alternate = { ...document("alternate"), branch: "draft/alternate" };
    const cache = createDocumentListCache({ storage, key }, async () => [
      document("one"),
      alternate,
    ]);
    await cache.read();
    await cache.mutate(
      async () => document("edited"),
      (value) => ({ id: "one", document: value }),
    );
    expect((await cache.read()).documents.map((d) => d.headSha).sort()).toEqual([
      "alternate",
      "edited",
    ]);
    await cache.mutate(
      async () => ({ ...document("published"), branch: null, state: "published" as const }),
      () => ({ id: "one", retireBranch: "draft/one" }),
    );
    expect((await cache.read()).documents).toEqual([alternate]);
    await cache.mutate(
      async () => ({}),
      () => ({ id: "one" }),
    );
    expect((await cache.read()).documents).toEqual([]);
  });
  test(`${name}: projections isolate repository/branch/schema scope and preserve multiple drafts`, async () => {
    const storage = adapter();
    const second = { ...document("alternate"), branch: "draft/alternate" };
    const first = createDocumentListCache(
      { storage, key: documentCacheView("repo/main/schema-a", "posts", "drafts") },
      async () => [document("one"), second],
    );
    const other = createDocumentListCache(
      { storage, key: documentCacheView("repo/concept/schema-b", "posts", "drafts") },
      async () => [document("private")],
    );
    expect((await first.read()).documents).toHaveLength(2);
    expect((await other.read()).documents).toEqual([document("private")]);
    expect((await first.read()).documents).toHaveLength(2);
  });
}
test("a cache outage never turns a successful Git write into a reported Git failure", async () => {
  const underlying = memoryDocumentCache();
  const storage: DocumentCacheStorage = {
    ...underlying,
    async finishWrite() {
      throw new Error("storage outage");
    },
  };
  const cache = createDocumentListCache({ storage, key: "test" }, async () => [document("before")]);
  await cache.read();
  let saved = false;
  const result = await cache.mutate(
    async () => {
      saved = true;
      return document("after");
    },
    (value) => ({ id: "one", document: value }),
  );
  expect(saved).toBe(true);
  expect(result.cacheWarning).toContain("Saved to Git");
  expect((await underlying.read("test")).initialized).toBe(false);
});

test("cold-fill persistence failure returns fetched Git data with degradation status", async () => {
  const underlying = memoryDocumentCache();
  const storage: DocumentCacheStorage = {
    ...underlying,
    async complete() {
      throw new Error("storage failed");
    },
  };
  const cache = createDocumentListCache({ storage, key: "test" }, async () => [
    document("authoritative"),
  ]);
  const result = await cache.read();
  expect(result.documents).toEqual([document("authoritative")]);
  expect(result.cache.error).toContain("cache is unavailable");
});

test("external refresh invalidates pages after committing rows; failures explicitly retry the page hook", async () => {
  const storage = memoryDocumentCache();
  let version = "old";
  const retries: boolean[] = [];
  const cache = createDocumentListCache(
    {
      storage,
      key: "pages",
      afterRefresh: async (_previous, next, retry) => {
        retries.push(!!retry);
        expect((await storage.read("pages")).documents).toEqual(next);
        if (retries.length === 1) throw new Error("page cache temporarily unavailable");
      },
    },
    async () => [document(version)],
  );
  await cache.read();
  expect(retries).toEqual([]);
  version = "new";
  expect((await cache.refresh()).cache.stale).toBe(true);
  expect((await cache.refresh()).cache.stale).toBe(false);
  expect(retries).toEqual([false, true]);
});

// SQL persists only explicit published/draft views; opaque keys remain memory-only.
test("SQL rejects opaque and malformed view descriptors", async () => {
  const storage = sqliteCache();
  for (const key of [
    "opaque",
    "null",
    JSON.stringify(["quiescent-documents-v2", "repo", "posts", "all"]),
  ]) {
    await expect(storage.read(key)).rejects.toThrow("documentCacheView descriptor");
    await expect(storage.beginWrite(key, 1, 100)).rejects.toThrow("documentCacheView descriptor");
  }
});
