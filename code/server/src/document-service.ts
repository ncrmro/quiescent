import type { LfsStorage } from "@quiescent/git";
import type { DocumentRecord } from "./contracts.ts";
import { createDocumentMedia } from "./document-assets.ts";
import { createDocumentListCache, type DocumentListCacheOptions } from "./document-cache.ts";
import {
  createDocumentStore,
  type DocumentStoreOptions,
  type Frontmatter,
} from "./document-store.ts";
import type { MediaStorage } from "./media.ts";

export function createDocumentService<T extends Frontmatter>(
  options: DocumentStoreOptions<T> & {
    cache?: DocumentListCacheOptions;
    media: MediaStorage;
    lfs: LfsStorage;
    references: (document: DocumentRecord<T>) => string[];
  },
) {
  const assets = createDocumentMedia({ ...options, delivery: options.media });
  const store = createDocumentStore({ ...options, assets });
  const cache = options.cache
    ? createDocumentListCache<T>(options.cache, store.listDocuments)
    : null;
  return {
    ...store,
    async listDocumentsWithStatus() {
      if (cache) return cache.read();
      return {
        documents: await store.listDocuments(),
        cache: { fetchedAt: null, updatedAt: null, stale: false, refreshing: false },
      };
    },
    async refreshDocuments() {
      if (cache) return cache.refresh();
      return {
        documents: await store.listDocuments(),
        cache: { fetchedAt: null, updatedAt: null, stale: false, refreshing: false },
      };
    },
    async listDocuments() {
      return cache ? (await cache.read()).documents : store.listDocuments();
    },
    async createDocument(...args: Parameters<typeof store.createDocument>) {
      return cache
        ? cache.mutate(
            () => store.createDocument(...args),
            (document) => ({ id: document.document.id, document }),
          )
        : store.createDocument(...args);
    },
    async getDraft(...args: Parameters<typeof store.getDraft>) {
      return cache
        ? cache.mutate(
            () => store.getDraft(...args),
            (document) => ({ id: document.document.id, document }),
          )
        : store.getDraft(...args);
    },
    async saveDraft(...args: Parameters<typeof store.saveDraft>) {
      return cache
        ? cache.mutate(
            () => store.saveDraft(...args),
            (document) => ({ id: document.document.id, document }),
          )
        : store.saveDraft(...args);
    },
    async publish(...args: Parameters<typeof store.publish>) {
      return cache
        ? cache.mutate(
            () => store.publish(...args),
            (result) => ({
              id: result.document.id,
              retireBranch: args[0].branch,
              document: {
                document: result.document,
                branch: null,
                headSha: result.publishedSha,
                state: "published",
              },
            }),
          )
        : store.publish(...args);
    },
    async deleteDocument(...args: Parameters<typeof store.deleteDocument>) {
      return cache
        ? cache.mutate(
            () => store.deleteDocument(...args),
            (result) => ({ id: result.id }),
          )
        : store.deleteDocument(...args);
    },
    references: options.references,
    media: options.media,
    async readMedia(id: string, filename: string, branch?: string) {
      const draft = branch ? await store.readDraft(id, branch) : await store.getPublished(id);
      if (!draft || !options.references(draft.document).includes(filename)) return null;
      const context = await store.location(id, draft.headSha);
      return assets.read(id, filename, { ...context, ref: draft.headSha });
    },
  };
}
