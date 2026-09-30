import { env } from "quiescent:runtime";
import { cachePublication } from "@quiescent/astro";
import { publishedMedia, writingErrorResponse } from "@quiescent/server";
import type { APIRoute } from "astro";
import { writingApp } from "../../writing/app";
export const prerender = false;
export const GET: APIRoute = async ({ params, cache }) => {
  try {
    const [id, asset, ...extra] = (params.path ?? "").split("/");
    if (!id || !asset || extra.length) return new Response("Not found", { status: 404 });
    const { service, media } = writingApp(env);
    const response = await publishedMedia(service, media, id, asset);
    if (response.ok) {
      cachePublication(cache, id);
      response.headers.set("Cache-Control", "public, max-age=0, must-revalidate");
    }
    return response;
  } catch (error) {
    return writingErrorResponse(error);
  }
};
