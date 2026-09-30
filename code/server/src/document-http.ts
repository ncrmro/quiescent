import { collectionRoutes, type PrivateHttpOptions, privateHandler } from "./collection-http.ts";
import type {
  createDocumentStore,
  DocumentInput,
  DocumentRecord,
  Frontmatter,
} from "./document-store.ts";
import { json } from "./http.ts";
export interface DocumentHandlerOptions<T extends Frontmatter> extends PrivateHttpOptions {
  store: ReturnType<typeof createDocumentStore<T>>;
  apiBase?: string;
  afterPublication?: (document: DocumentRecord<T>, deleted: boolean) => Promise<void>;
}
export function createDocumentHandler<T extends Frontmatter>(options: DocumentHandlerOptions<T>) {
  const { store } = options;
  const base = (options.apiBase ?? "/api/documents").replace(/\/$/, "");
  const routes = collectionRoutes({
    schema: store.schema,
    list: store.listDocuments,
    create: (data) => store.createDocument(data as unknown as DocumentInput<T>),
    get: store.getDraft,
    save: (selection, data) =>
      store.saveDraft({ ...selection, document: data.document as DocumentInput<T> }),
    publish: store.publish,
    delete: store.deleteDocument,
    afterPublish: async (result) => {
      await options.afterPublication?.(result.document, false);
    },
    afterDelete: async (result) => {
      await options.afterPublication?.(result.document, true);
    },
  });
  return privateHandler(options, async (request) => {
    const { pathname } = new URL(request.url);
    if (pathname !== base && !pathname.startsWith(`${base}/`))
      return json({ error: "Not found" }, 404);
    return routes(request, pathname.slice(base.length).split("/").filter(Boolean));
  });
}
