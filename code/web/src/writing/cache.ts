import type { PublishingSnapshotStore, PublishingSnapshot } from "@quiescent/server";
import type { D1Database } from "@cloudflare/workers-types";

/** D1 gives every Worker location the same prepared snapshot and atomic generation fence. */
export function publishingCache(db: D1Database, repository: string): PublishingSnapshotStore {
  const key = (scope: string) => `${repository}:${scope}`;
  return {
    async read(scope) {
      const row = await db.prepare("SELECT value, generation FROM writing_cache WHERE cache_key = ?")
        .bind(key(scope)).first<{value: string | null; generation:number}>();
      return row?.value ? {...JSON.parse(row.value) as PublishingSnapshot,generation:row.generation} : null;
    },
    async begin(scope) {
      const row = await db.prepare(`INSERT INTO writing_cache (cache_key, generation) VALUES (?, 1)
        ON CONFLICT(cache_key) DO UPDATE SET generation = generation + 1 RETURNING generation`)
        .bind(key(scope)).first<{generation: number}>();
      if (!row) throw new Error("Unable to start cache refresh");
      return row.generation;
    },
    async commit(scope, generation, snapshot) {
      const result = await db.prepare("UPDATE writing_cache SET value = ?, generation = generation + 1 WHERE cache_key = ? AND generation = ?")
        .bind(JSON.stringify(snapshot), key(scope), generation).run();
      return result.meta.changes === 1;
    },
  };
}
