import { collectionRoutes, type PrivateHttpOptions, privateHandler } from "./collection-http.ts";
import { mediaResponse, upload } from "./document-media-http.ts";
import type {
  createDocumentStore,
  DocumentInput,
  DocumentRecord,
  Frontmatter,
} from "./document-store.ts";
import { json } from "./http.ts";
import type { MediaStorage } from "./media.ts";
export interface DocumentHandlerOptions<T extends Frontmatter> extends PrivateHttpOptions {
  store: ReturnType<typeof createDocumentStore<T>>;
  apiBase?: string;
  media?: MediaStorage;
  readMedia?: (id: string, filename: string, branch?: string) => ReturnType<MediaStorage["read"]>;
  afterPublication?: (
    document: DocumentRecord<T>,
    deleted: boolean,
    previous?: DocumentRecord<T> | null,
  ) => Promise<void>;
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
      await options.afterPublication?.(result.document, false, result.previous);
    },
    afterDelete: async (result) => {
      await options.afterPublication?.(result.document, true, result.previous);
    },
  });
  async function readRoute(request: Request, parts: string[]) {
    const [id, action, ...rest] = parts;
    if (id && action === "published" && !rest.length && request.method === "GET") {
      const document = await store.getPublished(id);
      return document ? json(document) : json({ error: "Not found" }, 404);
    }
    if (
      id &&
      action === "media" &&
      rest.length === 1 &&
      request.method === "GET" &&
      options.media
    ) {
      await store.getDraft(id, new URL(request.url).searchParams.get("branch") ?? undefined);
      return mediaResponse(
        (await options.readMedia?.(
          id,
          rest[0]!,
          new URL(request.url).searchParams.get("branch") ?? undefined,
        )) ?? (await options.media.read(id, rest[0]!)),
      );
    }
    return null;
  }
  return privateHandler(options, async (request) => {
    const { pathname } = new URL(request.url);
    if (pathname !== base && !pathname.startsWith(`${base}/`))
      return json({ error: "Not found" }, 404);
    const parts = pathname.slice(base.length).split("/").filter(Boolean);
    const [id, action, ...rest] = parts;
    if (id && action === "uploads" && options.media)
      return upload(request, [id, ...rest], store, options.media);
    const response = await readRoute(request, parts);
    if (response) return response;
    return routes(request, parts);
  });
}
