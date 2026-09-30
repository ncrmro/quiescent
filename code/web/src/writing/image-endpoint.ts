import { env, transformImage } from "quiescent:runtime";
import { documentImageResponse } from "@quiescent/astro/images";
import { publishedMedia, writingErrorResponse } from "@quiescent/server";
import type { APIRoute } from "astro";
import { writingApp } from "./app";
export const prerender = false;
export const GET: APIRoute = async ({ request, cache, logger }) => {
  try {
    const { service, media } = writingApp(env);
    return await documentImageResponse({
      request,
      cache,
      logger,
      source: (id, filename) => publishedMedia(service, media, id, filename),
      transform: transformImage,
    });
  } catch (error) {
    return writingErrorResponse(error);
  }
};
