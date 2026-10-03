import {
  type DocumentCacheSnapshot,
  type DocumentCacheStorage,
  emptyDocumentCache,
} from "./document-cache-types.ts";

/** Bounded process-local adapter. Share one instance between request-scoped services. */
export function memoryDocumentCache(options: { maxEntries?: number } = {}): DocumentCacheStorage {
  const entries = new Map<string, DocumentCacheSnapshot>();
  const max = options.maxEntries ?? 32;
  if (!Number.isInteger(max) || max < 1) throw new Error("Cache capacity must be positive");
  function entry(key: string) {
    let value = entries.get(key);
    if (!value) {
      if (entries.size >= max) {
        const evict = [...entries].find(([, v]) => !v.pending && !v.lease);
        if (!evict) throw new Error("Document cache capacity exhausted");
        entries.delete(evict[0]);
      }
      value = emptyDocumentCache();
      entries.set(key, value);
    }
    return value;
  }
  return {
    async read(key) {
      return structuredClone(entry(key));
    },
    async claim(key, revision, lease, now, until) {
      const value = entry(key);
      if (
        value.revision !== revision ||
        (value.pending && value.writeUntil > now) ||
        (value.lease && value.leaseUntil > now)
      )
        return false;
      value.pending = 0;
      value.lease = lease;
      value.leaseUntil = until;
      return true;
    },
    async complete(key, lease, documents, now) {
      const value = entry(key);
      if (value.lease !== lease || value.pending) return false;
      Object.assign(value, {
        documents: structuredClone(documents),
        initialized: true,
        revision: value.revision + 1,
        lease: null,
        leaseUntil: 0,
        fetchedAt: now,
        retryAt: 0,
        updatedAt: now,
        error: undefined,
      });
      return true;
    },
    async fail(key, lease, error, retryAt) {
      const value = entry(key);
      if (value.lease === lease)
        Object.assign(value, { lease: null, leaseUntil: 0, error, retryAt });
    },
    async beginWrite(key, now, until) {
      const value = entry(key);
      if (value.writeUntil <= now) value.pending = 0;
      value.pending++;
      value.writeUntil = until;
      value.revision++;
      value.lease = null;
      value.leaseUntil = 0;
      return value.revision;
    },
    async finishWrite(key, revision, change, now) {
      const value = entry(key);
      const current = value.revision === revision;
      if (change && current) {
        value.documents = value.documents.filter(
          (d) =>
            d.document.id !== change.id ||
            (!!change.document &&
              d.branch !== null &&
              d.branch !== change.document.branch &&
              d.branch !== change.retireBranch),
        );
        if (
          change.document &&
          (change.document.branch !== null ||
            !value.documents.some((d) => d.document.id === change.id))
        )
          value.documents.unshift(structuredClone(change.document));
      }
      if (!current) value.initialized = false;
      value.pending = Math.max(0, value.pending - 1);
      value.lease = null;
      value.leaseUntil = 0;
      value.revision++;
      value.updatedAt = now;
      return current;
    },
    async invalidate(key, error) {
      const value = entry(key);
      Object.assign(value, {
        initialized: false,
        revision: value.revision + 1,
        lease: null,
        leaseUntil: 0,
        error,
      });
    },
  };
}
