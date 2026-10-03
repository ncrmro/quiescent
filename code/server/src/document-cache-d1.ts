import type { DocumentDraft } from "./contracts.ts";
import { type DocumentCacheStorage, emptyDocumentCache } from "./document-cache-types.ts";

/** Structural subset of D1; no Cloudflare dependency is required by the portable library. */
export interface DocumentCacheDatabase {
  prepare(sql: string): DocumentCacheStatement;
  batch<T = Record<string, unknown>>(
    statements: DocumentCacheStatement[],
  ): Promise<DocumentCacheQuery<T>[]>;
}
export interface DocumentCacheQuery<T> {
  results: T[];
  meta: { changes?: number };
}
export interface DocumentCacheStatement {
  bind(...values: unknown[]): DocumentCacheStatement;
  all<T = Record<string, unknown>>(): Promise<DocumentCacheQuery<T>>;
  run(): Promise<DocumentCacheQuery<Record<string, unknown>>>;
}
interface Metadata {
  revision: number;
  initialized: number;
  pending: number;
  write_until: number;
  retry_at: number;
  lease: string | null;
  lease_until: number;
  fetched_at: number | null;
  updated_at: number | null;
  error: string | null;
}
const table = "quiescent_document_cache";
const rows = "quiescent_document_cache_entries";
/** Install documents-cache.schema.sql once through the host's normal migration workflow. */
export function d1DocumentCache(database: DocumentCacheDatabase): DocumentCacheStorage {
  const sql = (query: string, ...values: unknown[]) => database.prepare(query).bind(...values);
  const ensure = (key: string) => sql(`INSERT OR IGNORE INTO ${table}(cache_key) VALUES (?)`, key);
  const guard = `EXISTS (SELECT 1 FROM ${table} WHERE cache_key = ? AND lease = ? AND pending = 0)`;
  return {
    async read(key) {
      const results = await database.batch<Metadata | { document_json: string }>([
        sql(`SELECT * FROM ${table} WHERE cache_key = ?`, key),
        sql(
          `SELECT document_json FROM ${rows} WHERE cache_key = ? ORDER BY document_id, branch`,
          key,
        ),
      ]);
      const meta = results[0]?.results[0] as Metadata | undefined;
      if (!meta) return emptyDocumentCache();
      return {
        documents: (results[1]?.results ?? []).map(
          (row) => JSON.parse((row as { document_json: string }).document_json) as DocumentDraft,
        ),
        revision: meta.revision,
        initialized: !!meta.initialized,
        pending: meta.pending,
        writeUntil: meta.write_until,
        retryAt: meta.retry_at,
        lease: meta.lease,
        leaseUntil: meta.lease_until,
        fetchedAt: meta.fetched_at,
        updatedAt: meta.updated_at,
        ...(meta.error ? { error: meta.error } : {}),
      };
    },
    async claim(key, revision, lease, now, until) {
      const results = await database.batch([
        ensure(key),
        sql(
          `UPDATE ${table} SET pending = 0, lease = ?, lease_until = ? WHERE cache_key = ? AND revision = ? AND (pending = 0 OR write_until <= ?) AND (lease IS NULL OR lease_until <= ?)`,
          lease,
          until,
          key,
          revision,
          now,
          now,
        ),
      ]);
      return results[1]?.meta.changes === 1;
    },
    async complete(key, lease, documents, now) {
      const changes = [
        sql(`DELETE FROM ${rows} WHERE cache_key = ? AND ${guard}`, key, key, lease),
      ];
      for (const document of documents)
        changes.push(
          sql(
            `INSERT INTO ${rows}(cache_key, document_id, branch, document_json) SELECT ?, ?, ?, ? WHERE ${guard}`,
            key,
            document.document.id,
            document.branch ?? "",
            JSON.stringify(document),
            key,
            lease,
          ),
        );
      changes.push(
        sql(
          `UPDATE ${table} SET initialized = 1, revision = revision + 1, lease = NULL, lease_until = 0, fetched_at = ?, updated_at = ?, error = NULL, retry_at = 0 WHERE cache_key = ? AND lease = ? AND pending = 0`,
          now,
          now,
          key,
          lease,
        ),
      );
      const result = await database.batch(changes);
      return result.at(-1)?.meta.changes === 1;
    },
    async fail(key, lease, error, retryAt) {
      await sql(
        `UPDATE ${table} SET lease = NULL, lease_until = 0, error = ?, retry_at = ? WHERE cache_key = ? AND lease = ?`,
        error,
        retryAt,
        key,
        lease,
      ).run();
    },
    async beginWrite(key, now, until) {
      const result = await database.batch<{ revision: number }>([
        ensure(key),
        sql(
          `UPDATE ${table} SET revision = revision + 1, pending = CASE WHEN write_until <= ? THEN 1 ELSE pending + 1 END, write_until = ?, lease = NULL, lease_until = 0 WHERE cache_key = ? RETURNING revision`,
          now,
          until,
          key,
        ),
      ]);
      const revision = result[1]?.results[0]?.revision;
      if (revision === undefined) throw new Error("Could not fence document cache mutation");
      return revision;
    },
    async finishWrite(key, revision, change, now) {
      const changes: DocumentCacheStatement[] = [];
      if (change) {
        changes.push(
          sql(
            `DELETE FROM ${rows} WHERE cache_key = ? AND document_id = ? AND (? = 1 OR branch = '' OR branch = ? OR branch = ?) AND EXISTS (SELECT 1 FROM ${table} WHERE cache_key = ? AND revision = ?)`,
            key,
            change.id,
            change.document ? 0 : 1,
            change.document?.branch ?? "",
            change.retireBranch ?? "",
            key,
            revision,
          ),
        );
        if (change.document)
          changes.push(
            sql(
              `INSERT INTO ${rows}(cache_key, document_id, branch, document_json) SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM ${table} WHERE cache_key = ? AND revision = ?) AND (? <> '' OR NOT EXISTS (SELECT 1 FROM ${rows} WHERE cache_key = ? AND document_id = ?))`,
              key,
              change.id,
              change.document.branch ?? "",
              JSON.stringify(change.document),
              key,
              revision,
              change.document.branch ?? "",
              key,
              change.id,
            ),
          );
      }
      changes.push(
        sql(
          `UPDATE ${table} SET initialized = CASE WHEN revision = ? THEN initialized ELSE 0 END, pending = MAX(0, pending - 1), lease = NULL, lease_until = 0, revision = revision + 1, updated_at = ? WHERE cache_key = ? RETURNING revision`,
          revision,
          now,
          key,
        ),
      );
      const result = await database.batch<{ revision: number }>(changes);
      return result.at(-1)?.results[0]?.revision === revision + 1;
    },
    async invalidate(key, error) {
      await database.batch([
        ensure(key),
        sql(
          `UPDATE ${table} SET initialized = 0, revision = revision + 1, lease = NULL, lease_until = 0, error = ? WHERE cache_key = ?`,
          error,
          key,
        ),
      ]);
    },
  };
}
