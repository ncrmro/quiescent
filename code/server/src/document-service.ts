import type { LfsStorage } from "@quiescent/git";
import type { DocumentDraft, DocumentRecord } from "./contracts.ts";
import { createDocumentMedia } from "./document-assets.ts";
import {
  createDocumentListCache,
  type DocumentCacheStatus,
  type DocumentListCacheOptions,
  type DocumentListing,
  type DocumentQuery,
  documentCacheView,
  selectDocuments,
  validateDocumentIndexes,
  validateDocumentQuery,
} from "./document-cache.ts";
import {
  createDocumentStore,
  DocumentError,
  type DocumentStoreOptions,
  type Frontmatter,
} from "./document-store.ts";
import type { MediaStorage } from "./media.ts";

const uncachedStatus: DocumentCacheStatus = {
  fetchedAt: null,
  updatedAt: null,
  stale: false,
  refreshing: false,
};
function combinedStatus(a: DocumentCacheStatus, b: DocumentCacheStatus): DocumentCacheStatus {
  return {
    fetchedAt:
      a.fetchedAt === null || b.fetchedAt === null ? null : Math.min(a.fetchedAt, b.fetchedAt),
    updatedAt: Math.max(a.updatedAt ?? 0, b.updatedAt ?? 0) || null,
    stale: a.stale || b.stale,
    refreshing: a.refreshing || b.refreshing,
    ...(a.error || b.error ? { error: a.error ?? b.error! } : {}),
  };
}
/** Git owns mutations. Independently fresh published/draft SQL views serve all warm reads. */
export function createDocumentService<T extends Frontmatter>(
  options: DocumentStoreOptions<T> & {
    cache?: Omit<DocumentListCacheOptions, "onPublishedChange"> & {
      onPublishedChange?: (
        previous: DocumentDraft<T>[],
        next: DocumentDraft<T>[],
        retry?: boolean,
      ) => Promise<void>;
    };
    indexes?: string[];
    media: MediaStorage;
    lfs: LfsStorage;
    references: (document: DocumentRecord<T>) => string[];
  },
) {
  const assets = createDocumentMedia({ ...options, delivery: options.media });
  const store = createDocumentStore({ ...options, assets });
  const indexes = options.indexes ?? options.cache?.indexes ?? [];
  validateDocumentIndexes(indexes, options.schema);
  const { onPublishedChange, ...cacheOptions } = options.cache ?? {};
  const publicCache = options.cache
    ? createDocumentListCache<T>(
        {
          ...cacheOptions,
          storage: options.cache.storage,
          indexes,
          key: documentCacheView(options.cache.key, options.collection, "published"),
          ...(onPublishedChange
            ? {
                afterRefresh: (previous: DocumentDraft[], next: DocumentDraft[], retry?: boolean) =>
                  onPublishedChange(
                    previous as DocumentDraft<T>[],
                    next as DocumentDraft<T>[],
                    retry,
                  ),
              }
            : {}),
        },
        store.listPublished,
      )
    : null;
  const draftCache = options.cache
    ? createDocumentListCache<T>(
        {
          ...cacheOptions,
          storage: options.cache.storage,
          indexes,
          key: documentCacheView(options.cache.key, options.collection, "drafts"),
          afterRefresh: async () => {},
        },
        () => store.listDrafts(),
      )
    : null;
  function select(documents: DocumentDraft<T>[], query: DocumentQuery = {}) {
    validateDocumentQuery(query, indexes);
    return selectDocuments(documents, query) as DocumentDraft<T>[];
  }
  async function listPublishedWithStatus(query?: DocumentQuery): Promise<DocumentListing<T>> {
    if (publicCache) return publicCache.read(query);
    return { documents: select(await store.listPublished(), query), cache: uncachedStatus };
  }
  async function listDocumentsWithStatus(query?: DocumentQuery): Promise<DocumentListing<T>> {
    if (!publicCache || !draftCache)
      return { documents: select(await store.listDocuments(), query), cache: uncachedStatus };
    const [published, drafts] = await Promise.all([publicCache.read(), draftCache.read()]);
    const ids = new Set(drafts.documents.map((d) => d.document.id));
    return {
      documents: select(
        [...drafts.documents, ...published.documents.filter((d) => !ids.has(d.document.id))],
        query,
      ),
      cache: combinedStatus(published.cache, drafts.cache),
    };
  }
  async function getPublished(id: string) {
    return (await listPublishedWithStatus({ id, limit: 1 })).documents[0] ?? null;
  }
  async function getPublishedBySlugWithStatus(slug: string) {
    const result = await listPublishedWithStatus({ slug, limit: 1 });
    return { document: result.documents[0] ?? null, cache: result.cache };
  }
  async function readDraft(id: string, branch?: string) {
    if (!draftCache) return store.readDraft(id, branch);
    const result = await draftCache.read({ id });
    return result.documents.find((d) => !branch || d.branch === branch) ?? null;
  }
  async function openDocument(id: string, branch?: string) {
    if (!draftCache) return store.openDocument(id, branch);
    const draft = await readDraft(id, branch);
    if (draft) return draft;
    const published = branch ? null : await getPublished(id);
    if (published) return published;
    throw new DocumentError("Document not found", "not_found");
  }
  return {
    ...store,
    listPublishedFromGit: store.listPublished,
    listDocumentsWithStatus,
    listPublishedWithStatus,
    getPublished,
    getPublishedBySlugWithStatus,
    readDraft,
    openDocument,
    async getPublishedBySlug(slug: string) {
      return (await getPublishedBySlugWithStatus(slug)).document;
    },
    async listPublished(query?: DocumentQuery) {
      return (await listPublishedWithStatus(query)).documents;
    },
    async listDocuments(query?: DocumentQuery) {
      return (await listDocumentsWithStatus(query)).documents;
    },
    async refreshDocuments() {
      if (publicCache && draftCache) {
        await Promise.all([publicCache.refresh(), draftCache.refresh()]);
        return listDocumentsWithStatus();
      }
      return listDocumentsWithStatus();
    },
    async createDocument(...args: Parameters<typeof store.createDocument>) {
      return draftCache
        ? draftCache.mutate(
            () => store.createDocument(...args),
            (document) => ({ id: document.document.id, document }),
          )
        : store.createDocument(...args);
    },
    async getDraft(...args: Parameters<typeof store.getDraft>) {
      return draftCache
        ? draftCache.mutate(
            () => store.getDraft(...args),
            (document) => ({ id: document.document.id, document }),
          )
        : store.getDraft(...args);
    },
    async saveDraft(...args: Parameters<typeof store.saveDraft>) {
      return draftCache
        ? draftCache.mutate(
            () => store.saveDraft(...args),
            (document) => ({ id: document.document.id, document }),
          )
        : store.saveDraft(...args);
    },
    async saveDocument(...args: Parameters<typeof store.saveDocument>) {
      return draftCache
        ? draftCache.mutate(
            () => store.saveDocument(...args),
            (document) => ({ id: document.document.id, document }),
          )
        : store.saveDocument(...args);
    },
    async publish(...args: Parameters<typeof store.publish>) {
      if (!publicCache || !draftCache) return store.publish(...args);
      return publicCache.mutate(
        () =>
          draftCache.mutate(
            () => store.publish(...args),
            (result) => ({ id: result.document.id, retireBranch: args[0].branch }),
          ),
        (result) => ({
          id: result.document.id,
          document: {
            document: result.document,
            branch: null,
            headSha: result.publishedSha,
            state: "published",
            ...(result.directory ? { directory: result.directory } : {}),
          },
        }),
      );
    },
    async deleteDocument(...args: Parameters<typeof store.deleteDocument>) {
      if (!publicCache || !draftCache) return store.deleteDocument(...args);
      return publicCache.mutate(
        () =>
          draftCache.mutate(
            () => store.deleteDocument(...args),
            (result) => ({ id: result.id }),
          ),
        (result) => ({ id: result.id }),
      );
    },
    references: options.references,
    media: options.media,
    async readMedia(id: string, filename: string, branch?: string) {
      const draft = branch ? await readDraft(id, branch) : await getPublished(id);
      if (!draft || !options.references(draft.document).includes(filename)) return null;
      const directory = draft.directory ?? (await store.location(id, draft.headSha)).directory;
      return assets.read(id, filename, { directory, ref: draft.headSha });
    },
  };
}
