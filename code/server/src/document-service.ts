import type { LfsStorage } from "@quiescent/git";
import type { DocumentRecord } from "./contracts.ts";
import { createDocumentMedia } from "./document-assets.ts";
import {
  createDocumentStore,
  type DocumentStoreOptions,
  type Frontmatter,
} from "./document-store.ts";
import type { MediaStorage } from "./media.ts";

export function createDocumentService<T extends Frontmatter>(
  options: DocumentStoreOptions<T> & {
    media: MediaStorage;
    lfs: LfsStorage;
    references: (document: DocumentRecord<T>) => string[];
  },
) {
  const assets = createDocumentMedia({ ...options, delivery: options.media });
  const store = createDocumentStore({ ...options, assets });
  return {
    ...store,
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
