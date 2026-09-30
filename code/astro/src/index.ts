import type { createPublishingService, MediaStorage, PostDocument } from "@quiescent/server";
import { createWritingHandler, writingErrorResponse } from "@quiescent/server";

import {
  astroDocumentCache,
  type CacheFetch,
  documentCachePolicy,
  type RouteCache,
} from "./documents.ts";

export * from "./documents.ts";
export const WRITING_CACHE_SECONDS = 86400;
export const publicationTag = (id: string) => `quiescent:post:${id}`;
export const readerPath = (post: Pick<PostDocument, "id" | "slug">) =>
  `/read/${post.id}/${encodeURIComponent(post.slug ?? "")}`;
const postPages = {
  collection: "posts",
  documentPath: readerPath,
  indexPaths: ["/", "/read"],
  documentTag: publicationTag,
  maxAge: WRITING_CACHE_SECONDS,
};
export function cachePublication(cache: RouteCache, id?: string) {
  cache.set(documentCachePolicy(postPages, id));
}
type Context = { request: Request; cache: RouteCache };
type Options = {
  service: ReturnType<typeof createPublishingService>;
  media: MediaStorage;
  authorize: (request: Request) => boolean | Promise<boolean>;
  origin: string;
  fetch?: CacheFetch;
};
/** The host mounts one handler. Publication, invalidation and eager warming stay together. */
export function astroWriting(options: Options) {
  const pages = astroDocumentCache<PostDocument>({
    ...options,
    ...postPages,
  });
  return {
    async api(context: Context): Promise<Response> {
      try {
        if (new URL(context.request.url).pathname === "/api/writing/cache/refresh") {
          if (context.request.method !== "POST")
            return new Response("Method not allowed", { status: 405 });
          if (
            !(await options.authorize(context.request)) ||
            context.request.headers.get("Origin") !== options.origin
          )
            return new Response("Unauthorized", { status: 403 });
          if (!context.cache.enabled)
            return Response.json({
              refreshed: false,
              reason: "Caching is disabled in development.",
            });
          const posts = await options.service.listPublished();
          return Response.json(
            await pages.refresh(
              context.cache,
              posts.map((p) => p.post),
            ),
          );
        }
        return await createWritingHandler({
          ...options,
          afterPublication: (post, deleted) => pages.afterPublication(context.cache, post, deleted),
        })(context.request);
      } catch (error) {
        return writingErrorResponse(error);
      }
    },
  };
}

/** Run in page frontmatter, before Astro starts streaming any HTML. */
export async function prepareReader(
  context: { cache: RouteCache; response: { headers: Headers } },
  service: Options["service"],
  id?: string,
) {
  const post = id ? await service.getPublished(id) : null;
  cachePublication(context.cache, id);
  context.response.headers.set("Cache-Control", "public, max-age=0, must-revalidate");
  context.response.headers.set("X-Quiescent-Rendered", crypto.randomUUID());
  if (id && !post)
    return new Response("Not found", { status: 404, headers: context.response.headers });
  context.response.headers.set("X-Quiescent-Revision", post?.headSha ?? "");
  return { post, posts: post ? [post] : await service.listPublished() };
}

export type { CacheFetch } from "./documents.ts";
