import {
  type createPublishingService,
  type PostDraft,
  postImageReferences,
} from "@quiescent/server";
import { documentMediaUrl } from "@quiescent/server/content";
import type { APIContext, ImageMetadata } from "astro";
import { imageMetadata } from "astro/assets/utils";
import type { RouteCache } from "./documents.ts";
import { cachePublication } from "./index.ts";

type Service = ReturnType<typeof createPublishingService>;
export type DocumentImages = Record<string, ImageMetadata>;
export interface ImageTransform {
  width: number;
  height: number;
  format: "webp";
  quality: number;
}
export type TransformImage = (
  source: Response,
  options: ImageTransform,
  logger: APIContext["logger"],
) => Promise<Response>;

/** Read dimensions once per document render; filenames in Markdown remain unchanged. */
export async function postImages(
  draft: PostDraft,
  service: Service,
  headerOnly = false,
): Promise<DocumentImages> {
  const images: DocumentImages = {};
  for (const ref of postImageReferences(draft.post)) {
    if (
      images[ref.assetId] ||
      (headerOnly && ref.assetId !== draft.post.headerImage?.split("/").at(-1))
    )
      continue;
    const object = await service.readMedia(ref.postId, ref.assetId);
    if (!object) continue;
    const metadata = await imageMetadata(
      new Uint8Array(await new Response(object.body).arrayBuffer()),
    );
    const source = {
      ...metadata,
      src: documentMediaUrl(ref.postId, ref.assetId, { revision: draft.headSha }),
    };
    images[ref.assetId] = source;
    images[`/media/${ref.postId}/${ref.assetId}`] = source;
  }
  return images;
}

/** Bridge Astro's generated image URLs to private delivery storage and native transforms. */
export async function documentImageResponse(options: {
  request: Request;
  cache: RouteCache;
  logger: APIContext["logger"];
  source: (id: string, filename: string) => Promise<Response>;
  transform: TransformImage;
}) {
  const params = new URL(options.request.url).searchParams;
  const href = params.get("href") ?? "";
  const match = /^\/media\/([a-zA-Z0-9-]+)\/([a-zA-Z0-9_.-]+)(?:\?v=[a-zA-Z0-9-]+)?$/.exec(href);
  const width = Number(params.get("w"));
  const height = Number(params.get("h"));
  const quality = Number(params.get("q") ?? 80);
  if (
    !match ||
    params.get("f") !== "webp" ||
    !Number.isInteger(width) ||
    width < 1 ||
    width > 1440 ||
    !Number.isInteger(height) ||
    height < 1 ||
    height > 8192 ||
    !Number.isInteger(quality) ||
    quality < 1 ||
    quality > 100
  )
    return new Response("Invalid image request", { status: 400 });
  const response = await options.source(match[1]!, match[2]!);
  if (!response.ok) return response;
  const transformed = await options.transform(
    response,
    { width, height, format: "webp", quality },
    options.logger,
  );
  const image = new Response(transformed.body, {
    status: transformed.status,
    headers: transformed.headers,
  });
  if (image.ok) {
    cachePublication(options.cache, match[1]!);
    image.headers.set("Cache-Control", "public, max-age=0, must-revalidate");
  }
  return image;
}
