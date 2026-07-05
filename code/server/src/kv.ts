/**
 * Minimal key-value contract for sessions and drafts. Cloudflare KV
 * namespaces satisfy it structurally; self-hosted deployments implement it
 * over Redis, SQLite, the filesystem, or anything else with string keys.
 */
export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
  list(options?: {
    prefix?: string;
    cursor?: string;
  }): Promise<{
    keys: { name: string }[];
    list_complete: boolean;
    cursor?: string;
  }>;
}

/** In-memory store for tests and single-process self-hosted setups. */
export function createMemoryStore(): KeyValueStore {
  const data = new Map<string, { value: string; expiresAt?: number }>();
  const live = (key: string) => {
    const entry = data.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== undefined && entry.expiresAt <= Date.now()) {
      data.delete(key);
      return null;
    }
    return entry;
  };
  return {
    async get(key) {
      return live(key)?.value ?? null;
    },
    async put(key, value, options) {
      data.set(key, {
        value,
        expiresAt: options?.expirationTtl ? Date.now() + options.expirationTtl * 1000 : undefined,
      });
    },
    async delete(key) {
      data.delete(key);
    },
    async list(options) {
      const prefix = options?.prefix ?? "";
      const keys = [...data.keys()]
        .filter((k) => k.startsWith(prefix) && live(k))
        .map((name) => ({ name }));
      return { keys, list_complete: true };
    },
  };
}
