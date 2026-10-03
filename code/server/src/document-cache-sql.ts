import type { DocumentDraft } from "./contracts.ts";
import { cacheScope, type DocumentQuery } from "./document-cache-query.ts";
import {
  type DocumentCacheChange,
  type DocumentCacheStorage,
  emptyDocumentCache,
} from "./document-cache-types.ts";
/** SQLite-compatible structural transaction interface shared by D1 and local adapters. */
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
interface Row {
  document_id: string;
  branch: string;
  frontmatter_json: string;
  body: string;
  revision: string;
  created_at: string;
  published_at: string | null;
  directory: string | null;
}
const table = "quiescent_document_cache";
const rows = "quiescent_documents";
const columns =
  "scope, collection, document_id, branch, slug, frontmatter_json, body, revision, created_at, published_at, directory, updated_at";
function rowDocument(row: Row): DocumentDraft {
  return {
    document: {
      id: row.document_id,
      createdAt: row.created_at,
      ...(row.published_at ? { publishedAt: row.published_at } : {}),
      frontmatter: JSON.parse(row.frontmatter_json),
      body: row.body,
    },
    branch: row.branch || null,
    headSha: row.revision,
    state: row.branch ? (row.published_at ? "unpublished-changes" : "draft") : "published",
    ...(row.directory ? { directory: row.directory } : {}),
  };
}
function selection(key: string) {
  const { scope, collection, view } = cacheScope(key);
  return {
    clause: `scope = ? AND collection = ?${view === "all" ? "" : view === "published" ? " AND branch = ''" : " AND branch <> ''"}`,
    values: [scope, collection],
  };
}
function expression(field: string) {
  const builtin: Record<string, string> = {
    id: "document_id",
    slug: "slug",
    createdAt: "created_at",
    publishedAt: "published_at",
  };
  if (Object.hasOwn(builtin, field)) return builtin[field]!;
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(field)) throw new Error("Invalid scalar query field");
  return `json_extract(frontmatter_json, '$.${field}')`;
}
function querySQL(query: DocumentQuery) {
  let clause = "";
  const values: unknown[] = [];
  for (const [field, value] of [
    ["id", query.id],
    ["slug", query.slug],
  ] as const)
    if (value !== undefined) {
      clause += ` AND ${expression(field)} = ?`;
      values.push(value);
    }
  for (const condition of query.where ?? []) {
    const operator = { eq: "IS", lt: "<", lte: "<=", gt: ">", gte: ">=" }[condition.op];
    if (!operator) throw new Error("Invalid query operator");
    clause += ` AND ${expression(condition.field)} ${operator} ?`;
    values.push(typeof condition.value === "boolean" ? Number(condition.value) : condition.value);
  }
  clause +=
    " ORDER BY " +
    [
      ...(query.orderBy ?? []).map(
        (order) => `${expression(order.field)} ${order.direction === "desc" ? "DESC" : "ASC"}`,
      ),
      "document_id",
      "branch",
    ].join(", ");
  if (query.limit !== undefined || query.offset !== undefined) {
    clause += " LIMIT ? OFFSET ?";
    values.push(query.limit ?? -1, query.offset ?? 0);
  }
  return { clause, values };
}
function valuesFor(key: string, document: DocumentDraft, now: number) {
  const { scope, collection } = cacheScope(key);
  return [
    scope,
    collection,
    document.document.id,
    document.branch ?? "",
    typeof document.document.frontmatter.slug === "string"
      ? document.document.frontmatter.slug
      : null,
    JSON.stringify(document.document.frontmatter),
    document.document.body,
    document.headSha,
    document.document.createdAt,
    document.document.publishedAt ?? null,
    document.directory ?? null,
    now,
  ];
}
const ensuredIndexes = new WeakMap<DocumentCacheDatabase, Map<string, Promise<void>>>();
/** Rows share one physical table; freshness and writer fences are isolated by view. */
export function sqlDocumentCache(database: DocumentCacheDatabase): DocumentCacheStorage {
  const sql = (query: string, ...values: unknown[]) => database.prepare(query).bind(...values);
  const ensure = (key: string) => sql(`INSERT OR IGNORE INTO ${table}(cache_key) VALUES (?)`, key);
  const guard = `EXISTS (SELECT 1 FROM ${table} WHERE cache_key = ? AND lease = ? AND pending = 0)`;
  function removeProjected(key: string, revision: number, change: DocumentCacheChange) {
    const scope = selection(key);
    const view = cacheScope(key).view;
    const check = `EXISTS (SELECT 1 FROM ${table} WHERE cache_key = ? AND revision = ?)`;
    const removeAll = !change.document && !change.retireBranch;
    return sql(
      `DELETE FROM ${rows} WHERE ${scope.clause} AND document_id = ? AND (? = 1 OR branch = ? OR branch = ? OR (branch = '' AND ? = 1)) AND ${check}`,
      ...scope.values,
      change.id,
      Number(removeAll),
      change.document?.branch ?? "",
      change.retireBranch ?? "",
      Number(view === "all"),
      key,
      revision,
    );
  }
  function insertProjected(key: string, revision: number, document: DocumentDraft, now: number) {
    const scope = selection(key);
    const view = cacheScope(key).view;
    if (
      (view === "published" && document.branch !== null) ||
      (view === "drafts" && document.branch === null)
    )
      throw new Error("Document cache visibility mismatch");
    const check = `EXISTS (SELECT 1 FROM ${table} WHERE cache_key = ? AND revision = ?)`;
    const hide =
      view === "all" && document.branch === null
        ? ` AND NOT EXISTS (SELECT 1 FROM ${rows} WHERE ${scope.clause} AND document_id = ?)`
        : "";
    return sql(
      `INSERT INTO ${rows}(${columns}) SELECT ${Array(12).fill("?").join(",")} WHERE ${check}${hide}`,
      ...valuesFor(key, document, now),
      key,
      revision,
      ...(hide ? [...scope.values, document.document.id] : []),
    );
  }
  function projection(
    key: string,
    revision: number,
    change: DocumentCacheChange | null,
    now: number,
  ) {
    if (!change) return [];
    const changes = [removeProjected(key, revision, change)];
    if (change.document) changes.push(insertProjected(key, revision, change.document, now));
    return changes;
  }
  return {
    async ensureIndexes(indexes) {
      let pending = ensuredIndexes.get(database);
      if (!pending) {
        pending = new Map();
        ensuredIndexes.set(database, pending);
      }
      for (const field of indexes) {
        let work = pending.get(field);
        if (!work) {
          work = sql(
            `CREATE INDEX IF NOT EXISTS quiescent_scalar_${field} ON ${rows}(scope, collection, ${expression(field)}, branch)`,
          )
            .run()
            .then(() => undefined);
          if (pending.size >= 128) pending.delete(pending.keys().next().value!);
          pending.set(field, work);
        }
        try {
          await work;
        } catch (error) {
          pending.delete(field);
          throw error;
        }
      }
    },
    async read(key, query = {}) {
      const scope = selection(key);
      const filter = querySQL(query);
      const result = await database.batch<Metadata | Row>([
        sql(`SELECT * FROM ${table} WHERE cache_key = ?`, key),
        sql(
          `SELECT * FROM ${rows} WHERE ${scope.clause}${filter.clause}`,
          ...scope.values,
          ...filter.values,
        ),
      ]);
      const meta = result[0]?.results[0] as Metadata | undefined;
      if (!meta) return emptyDocumentCache();
      return {
        documents: (result[1]?.results ?? []).map((row) => rowDocument(row as Row)),
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
      const result = await database.batch([
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
      return result[1]?.meta.changes === 1;
    },
    async complete(key, lease, documents, now) {
      const scope = selection(key);
      const changes = [
        sql(`DELETE FROM ${rows} WHERE ${scope.clause} AND ${guard}`, ...scope.values, key, lease),
      ];
      const view = cacheScope(key).view;
      for (const document of documents) {
        if (
          (view === "published" && document.branch !== null) ||
          (view === "drafts" && document.branch === null)
        )
          throw new Error("Document cache visibility mismatch");
        changes.push(
          sql(
            `INSERT INTO ${rows}(${columns}) SELECT ${Array(12).fill("?").join(",")} WHERE ${guard}`,
            ...valuesFor(key, document, now),
            key,
            lease,
          ),
        );
      }
      changes.push(
        sql(
          `UPDATE ${table} SET initialized = 1, revision = revision + 1, lease = NULL, lease_until = 0, fetched_at = ?, updated_at = ?, error = NULL, retry_at = 0 WHERE cache_key = ? AND lease = ? AND pending = 0`,
          now,
          now,
          key,
          lease,
        ),
      );
      return (await database.batch(changes)).at(-1)?.meta.changes === 1;
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
      const changes = projection(key, revision, change, now);
      changes.push(
        sql(
          `UPDATE ${table} SET initialized = CASE WHEN revision = ? THEN initialized ELSE 0 END, pending = MAX(0, pending - 1), lease = NULL, lease_until = 0, revision = revision + 1, updated_at = ? WHERE cache_key = ? RETURNING revision`,
          revision,
          now,
          key,
        ),
      );
      return (
        (await database.batch<{ revision: number }>(changes)).at(-1)?.results[0]?.revision ===
        revision + 1
      );
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
