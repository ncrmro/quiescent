import { collectionRoutes, type PrivateHttpOptions, privateHandler } from "./collection-http.ts";
import { DocumentError } from "./document-error.ts";
import { json, payload } from "./http.ts";
import { MediaError, type MediaStorage } from "./media.ts";
import {
  type createPublishingService,
  type PostDocument,
  postImageReferences,
} from "./publishing.ts";

export {
  documentErrorResponse as writingErrorResponse,
  payload,
  WritingConfigurationError,
} from "./http.ts";

type Service = ReturnType<typeof createPublishingService>;
interface WritingHandlerOptions extends PrivateHttpOptions {
  service: Service;
  media: MediaStorage;
  apiBase?: string;
  afterPublication?: (post: PostDocument, deleted: boolean) => Promise<void>;
}
async function upload(request: Request, parts: string[], service: Service, media: MediaStorage) {
  const [id, asset, operation] = parts;
  if (!id || parts.length > 3) return json({ error: "Not found" }, 404);
  await service.getDraft(id);
  if (!asset && request.method === "POST") {
    const data = await payload(request);
    if (typeof data.contentType !== "string" || typeof data.size !== "number")
      throw new MediaError("Image metadata missing");
    return json(await media.prepare(id, data.contentType, data.size));
  }
  if (!asset) return json({ error: "Not found" }, 404);
  if (operation === "confirm" && request.method === "POST") {
    const data = await payload(request);
    return json(
      await media.confirm(id, asset, typeof data.filename === "string" ? data.filename : undefined),
    );
  }
  if (!operation && request.method === "PUT" && media.uploadLocal) {
    await media.uploadLocal(id, asset, request);
    return json({ ok: true });
  }
  return json({ error: "Not found" }, 404);
}
/** Posts configure the same CRUD dispatcher used by arbitrary documents. */
export function createWritingHandler(options: WritingHandlerOptions) {
  const { service, media } = options;
  const base = options.apiBase ?? "/api/writing";
  const routes = collectionRoutes({
    schema: service.schema,
    list: service.listPosts,
    create: service.createPost,
    get: service.getDraft,
    save: (selection, data) => {
      if (!data.post || typeof data.post !== "object")
        throw new DocumentError("Post missing", "invalid");
      return service.saveDraft({ ...selection, post: data.post as PostDocument });
    },
    publish: service.publish,
    delete: service.deletePost,
    afterPublish: async (result) => {
      await options.afterPublication?.(result.post, false);
    },
    afterDelete: async (result) => {
      await options.afterPublication?.(result.post, true);
    },
  });
  return privateHandler(options, async (request) => {
    const url = new URL(request.url);
    if (!url.pathname.startsWith(`${base}/`)) return json({ error: "Not found" }, 404);
    const [resource, id, action, ...rest] = url.pathname
      .slice(base.length)
      .split("/")
      .filter(Boolean);
    if (resource === "posts" && action === "uploads")
      return upload(request, [id!, ...rest], service, media);
    if (resource === "posts")
      return routes(
        request,
        [id, action, ...rest].filter((part): part is string => part !== undefined),
      );
    if (resource === "schema" && !id && request.method === "GET") return json(service.schema);
    return readRoute(request, [resource, id, action, ...rest], service, media);
  });
}
function mediaResponse(object: Awaited<ReturnType<MediaStorage["read"]>>) {
  return object
    ? new Response(object.body, {
        headers: {
          "Content-Type": object.contentType,
          "Content-Length": String(object.size),
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      })
    : json({ error: "Image not found" }, 404);
}
export async function publishedMedia(
  service: Service,
  _media: MediaStorage,
  id: string,
  assetId: string,
) {
  const post = await service.getPublished(id);
  if (
    !post ||
    !postImageReferences(post.post).some((r) => r.postId === id && r.assetId === assetId)
  )
    return json({ error: "Image not found" }, 404);
  return mediaResponse(await service.readMedia(id, assetId));
}

async function readRoute(
  request: Request,
  parts: (string | undefined)[],
  service: Service,
  media: MediaStorage,
) {
  const [resource, id, action, ...rest] = parts;
  if (resource === "published" && id && !action && request.method === "GET") {
    const post = await service.getPublished(id);
    return post ? json(post) : json({ error: "Post not found" }, 404);
  }
  if (resource === "media" && id && action && !rest.length && request.method === "GET") {
    const branch = new URL(request.url).searchParams.get("branch") ?? undefined;
    // Draft reads use their captured branch; staged uploads can preview before the atomic save.
    return mediaResponse(
      (await service.readMedia(id, action, branch)) ?? (await media.read(id, action)),
    );
  }
  return json({ error: "Not found" }, 404);
}
