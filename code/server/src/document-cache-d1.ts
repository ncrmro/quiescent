import { type DocumentCacheDatabase, sqlDocumentCache } from "./document-cache-sql.ts";

export type {
  DocumentCacheDatabase,
  DocumentCacheQuery,
  DocumentCacheStatement,
} from "./document-cache-sql.ts";
/** D1 supplies atomic batch transactions to the same SQL projection used by local SQLite. */
export function d1DocumentCache(database: DocumentCacheDatabase) {
  return sqlDocumentCache(database);
}
