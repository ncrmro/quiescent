import type { DocumentDraft } from "./contracts.ts";
import type { DocumentQuery } from "./document-cache-query.ts";
import type { Frontmatter } from "./document-codec.ts";

export interface DocumentCacheStatus {
  fetchedAt: number | null;
  expiresAt: number | null;
  updatedAt: number | null;
  stale: boolean;
  refreshing: boolean;
  error?: string;
}
export interface DocumentListing<T extends Frontmatter = Frontmatter> {
  documents: DocumentDraft<T>[];
  cache: DocumentCacheStatus;
}
export interface DocumentCacheSnapshot {
  documents: DocumentDraft[];
  revision: number;
  initialized: boolean;
  pending: number;
  writeUntil: number;
  retryAt: number;
  lease: string | null;
  leaseUntil: number;
  fetchedAt: number | null;
  updatedAt: number | null;
  error?: string;
}
export type DocumentCacheChange = { id: string; document?: DocumentDraft; retireBranch?: string };
/** All mutations are atomic. Refresh completion must test its lease in the same transaction. */
export interface DocumentCacheStorage {
  read(key: string, query?: DocumentQuery): Promise<DocumentCacheSnapshot>;
  claim(key: string, revision: number, lease: string, now: number, until: number): Promise<boolean>;
  complete(key: string, lease: string, documents: DocumentDraft[], now: number): Promise<boolean>;
  fail(key: string, lease: string, error: string, retryAt: number): Promise<void>;
  beginWrite(key: string, now: number, until: number): Promise<number>;
  finishWrite(
    key: string,
    revision: number,
    change: DocumentCacheChange | null,
    now: number,
  ): Promise<boolean>;
  invalidate(key: string, error: string): Promise<void>;
}
export interface DocumentListCacheOptions {
  storage: DocumentCacheStorage;
  indexes?: string[];
  afterRefresh?: (
    previous: DocumentDraft[],
    next: DocumentDraft[],
    retry?: boolean,
  ) => Promise<void>;
  /** Scope by repository, published branch, collection, schema, and configuration version. */
  key: string;
  ttlMs?: number;
  waitUntil?: (promise: Promise<unknown>) => void;
  /** Injectable clock for self-hosted runtimes and deterministic verification. */
  now?: () => number;
  leaseMs?: number;
}
export function emptyDocumentCache(): DocumentCacheSnapshot {
  return {
    documents: [],
    revision: 0,
    initialized: false,
    pending: 0,
    writeUntil: 0,
    retryAt: 0,
    lease: null,
    leaseUntil: 0,
    fetchedAt: null,
    updatedAt: null,
  };
}
/** Stable serialization: the caller supplies the complete repository/collection/schema scope. */
export function documentCacheKey(scope: Record<string, unknown>): string {
  return JSON.stringify(scope);
}
