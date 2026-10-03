import type { MediaStorage } from "@quiescent/server";
import { type DocumentMediaUrlResolver, documentMediaUrl } from "@quiescent/server/content";
import type { DocumentDraft, Frontmatter } from "@quiescent/server/documents";
import type { APIContext, ImageMetadata } from "astro";
import { imageMetadata } from "astro/assets/utils";
import type { RouteCache } from "./documents.ts";
export type DocumentImages = Record<string, ImageMetadata>;
export interface ImageTransform {
  width: number;
  height: number;
  format: "webp" | "avif" | "png" | "jpeg";
  quality: number;
}
export type TransformImage = (
  source: Response,
  options: ImageTransform,
  logger: APIContext["logger"],
) => Promise<Response>;

/** Read dimensions once per document render; filenames in Markdown remain unchanged. */
export async function documentImages<T extends Frontmatter>(
  draft: DocumentDraft<T>,
  filenames: string[],
  read: (id: string, filename: string) => ReturnType<MediaStorage["read"]>,
  options: { mediaUrl?: DocumentMediaUrlResolver } = {},
): Promise<DocumentImages> {
  const images: DocumentImages = {};
  for (const filename of new Set(filenames)) {
    const object = await read(draft.document.id, filename);
    if (!object) continue;
    const metadata = await imageMetadata(
      new Uint8Array(await new Response(object.body).arrayBuffer()),
    );
    images[filename] = {
      ...metadata,
      src: documentMediaUrl(draft.document.id, filename, {
        revision: draft.headSha,
        ...(options.mediaUrl ? { resolveUrl: options.mediaUrl } : {}),
      }),
    };
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
  const format = params.get("f");
  const width = Number(params.get("w"));
  const height = Number(params.get("h"));
  const quality = Number(params.get("q") ?? 80);
  if (
    !match ||
    !["webp", "avif", "png", "jpeg"].includes(format ?? "") ||
    !Number.isInteger(width) ||
    width < 1 ||
    width > 8192 ||
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
    { width, height, format: format as ImageTransform["format"], quality },
    options.logger,
  );
  const image = new Response(transformed.body, {
    status: transformed.status,
    headers: transformed.headers,
  });
  if (image.ok) {
    image.headers.set("Cache-Control", "public, max-age=0, must-revalidate");
  }
  return image;
}
