import { cacheScope, documentCacheView } from "./document-cache-query.ts";
import type { DocumentCacheStorage } from "./document-cache-types.ts";

/** Hash repository/schema scopes before storing them in each SQL row and index. */
export function compactDocumentCache(storage: DocumentCacheStorage): DocumentCacheStorage {
  const keys = new Map<string, Promise<string>>();
  function key(value: string) {
    let result = keys.get(value);
    if (!result) {
      const { scope, collection, view } = cacheScope(value);
      result = crypto.subtle.digest("SHA-256", new TextEncoder().encode(scope)).then((bytes) => {
        const hash = Array.from(new Uint8Array(bytes), (byte) =>
          byte.toString(16).padStart(2, "0"),
        ).join("");
        return documentCacheView(hash, collection, view);
      });
      if (keys.size >= 64) keys.delete(keys.keys().next().value!);
      keys.set(value, result);
    }
    return result;
  }
  return {
    async read(value, query) {
      return storage.read(await key(value), query);
    },
    async claim(value, ...args) {
      return storage.claim(await key(value), ...args);
    },
    async complete(value, ...args) {
      return storage.complete(await key(value), ...args);
    },
    async fail(value, ...args) {
      return storage.fail(await key(value), ...args);
    },
    async beginWrite(value, ...args) {
      return storage.beginWrite(await key(value), ...args);
    },
    async finishWrite(value, ...args) {
      return storage.finishWrite(await key(value), ...args);
    },
    async invalidate(value, ...args) {
      return storage.invalidate(await key(value), ...args);
    },
  };
}
