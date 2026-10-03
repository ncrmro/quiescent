import { jsonEqual } from "./content/equality.ts";
import type { DocumentDraft, MutationResponse } from "./contracts.ts";
import {
  type DocumentQuery,
  selectDocuments,
  validateDocumentQuery,
} from "./document-cache-query.ts";
import type {
  DocumentCacheChange,
  DocumentCacheSnapshot,
  DocumentListCacheOptions,
  DocumentListing,
} from "./document-cache-types.ts";
import type { Frontmatter } from "./document-codec.ts";

export * from "./document-cache-d1.ts";
export * from "./document-cache-memory.ts";
export * from "./document-cache-query.ts";
export { documentCacheIndexStatements } from "./document-cache-sql.ts";
export * from "./document-cache-types.ts";

const warning =
  "Saved to Git, but the document listing cache could not be updated. Refresh the listing to rebuild it.";

export function createDocumentListCache<T extends Frontmatter>(
  options: DocumentListCacheOptions,
  load: () => Promise<DocumentDraft<T>[]>,
) {
  const { storage, key } = options;
  const ttl = options.ttlMs ?? 60 * 60 * 1000;
  const now = options.now ?? Date.now;
  if (!key || !Number.isFinite(ttl) || ttl <= 0)
    throw new Error("Invalid document cache configuration");
  function listing(snapshot: DocumentCacheSnapshot): DocumentListing<T> {
    return {
      documents: snapshot.documents as DocumentDraft<T>[],
      cache: {
        fetchedAt: snapshot.fetchedAt,
        expiresAt: snapshot.fetchedAt === null ? null : snapshot.fetchedAt + ttl,
        updatedAt: snapshot.updatedAt,
        stale:
          !snapshot.initialized ||
          (snapshot.pending > 0 && snapshot.writeUntil <= now()) ||
          snapshot.fetchedAt === null ||
          now() - snapshot.fetchedAt >= ttl,
        refreshing: snapshot.lease !== null && snapshot.leaseUntil > now(),
        ...(snapshot.error ? { error: snapshot.error } : {}),
      },
    };
  }
  function degraded(documents: DocumentDraft<T>[]): DocumentListing<T> {
    return {
      documents,
      cache: {
        fetchedAt: null,
        expiresAt: null,
        updatedAt: null,
        stale: true,
        refreshing: false,
        error: "Document cache is unavailable; this listing was read from Git.",
      },
    };
  }
  async function afterRefresh(previous: DocumentCacheSnapshot, documents: DocumentDraft<T>[]) {
    if (!options.afterRefresh) return;
    const retry = previous.error?.includes("page invalidation failed");
    if (!previous.initialized && !retry) return;
    if (!retry && samePublishedDocuments(previous.documents, documents)) return;
    try {
      await options.afterRefresh(previous.documents, documents, !!retry);
    } catch {
      await storage.invalidate(
        key,
        "Documents refreshed, but published page invalidation failed. Refresh again to retry.",
      );
    }
  }
  async function loadRefresh(
    previous: DocumentCacheSnapshot,
    lease: string,
  ): Promise<DocumentListing<T>> {
    let documents: DocumentDraft<T>[];
    try {
      documents = await load();
    } catch (error) {
      await storage
        .fail(key, lease, "Git refresh failed; the previous listing is retained.", now() + 30_000)
        .catch(() => undefined);
      if (!previous.initialized) throw error;
      const current = await storage.read(key).catch(() => previous);
      return listing(current);
    }
    try {
      const completed = await storage.complete(key, lease, documents, now());
      if (completed) await afterRefresh(previous, documents);
      const current = await storage.read(key);
      if (!current.initialized)
        return { documents, cache: { ...listing(current).cache, stale: true } };
      return listing(current);
    } catch {
      await storage
        .fail(
          key,
          lease,
          "Fetched Git documents, but could not persist the listing cache.",
          now() + 30_000,
        )
        .catch(() => undefined);
      return degraded(documents);
    }
  }
  async function refresh(): Promise<DocumentListing<T>> {
    let previous: DocumentCacheSnapshot;
    const lease = crypto.randomUUID();
    let claimed: boolean;
    try {
      previous = await storage.read(key);
      claimed = await storage.claim(
        key,
        previous.revision,
        lease,
        now(),
        now() + (options.leaseMs ?? 120_000),
      );
    } catch {
      return degraded(await load());
    }
    if (claimed) return loadRefresh(previous, lease);
    if (previous.initialized) return listing(await storage.read(key));
    // Another writer owns the projection. Read Git, but never commit through someone else's fence.
    return {
      documents: await load(),
      cache: { ...listing(previous).cache, stale: true, refreshing: true },
    };
  }
  async function read(query?: DocumentQuery): Promise<DocumentListing<T>> {
    if (query) validateDocumentQuery(query, options.indexes ?? []);
    const selected = (result: DocumentListing<T>) =>
      query
        ? { ...result, documents: selectDocuments(result.documents, query) as DocumentDraft<T>[] }
        : result;
    let snapshot: DocumentCacheSnapshot;
    try {
      snapshot = await storage.read(key, query);
    } catch {
      return selected(degraded(await load()));
    }

    if (!snapshot.initialized) return selected(await refresh());
    const result = listing(snapshot);
    if (
      result.cache.stale &&
      !result.cache.refreshing &&
      snapshot.retryAt <= now() &&
      (!snapshot.pending || snapshot.writeUntil <= now())
    ) {
      if (!options.waitUntil) return selected(await refresh());
      const work = refresh().catch(() => undefined);
      options.waitUntil(work);
      result.cache.refreshing = true;
    }
    return result;
  }
  async function invalidate() {
    await storage.invalidate(key, warning).catch(() => undefined);
  }
  async function project<R extends object>(
    revision: number,
    result: R,
    change: DocumentCacheChange | null,
  ): Promise<MutationResponse<R>> {
    try {
      const current = await storage.finishWrite(key, revision, change, now());
      if (!current) throw new Error("Concurrent projection changed");
      if (!(await storage.read(key)).initialized) await refresh();
      return result;
    } catch {
      await invalidate();
      return { ...result, cacheWarning: warning };
    }
  }
  async function mutate<R extends object>(
    operation: () => Promise<R>,
    change: (result: R) => DocumentCacheChange | null,
  ): Promise<MutationResponse<R>> {
    let revision: number | undefined;
    try {
      revision = await storage.beginWrite(key, now(), now() + (options.leaseMs ?? 120_000));
    } catch {
      /* Git remains writable during a cache outage. */
    }
    let result: R;
    try {
      result = await operation();
    } catch (error) {
      if (revision !== undefined)
        await storage.finishWrite(key, revision, null, now()).catch(invalidate);
      throw error;
    }
    if (revision === undefined) {
      await invalidate();
      return { ...result, cacheWarning: warning };
    }
    return project(revision, result, change(result));
  }
  return { read, refresh, mutate };
}

function samePublishedDocuments(previous: DocumentDraft[], next: DocumentDraft[]) {
  if (previous.length !== next.length) return false;
  const before = new Map(previous.map((item) => [item.document.id, item.document]));
  return next.every((item) => jsonEqual(before.get(item.document.id), item.document));
}
