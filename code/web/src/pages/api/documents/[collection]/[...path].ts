import type { APIRoute } from "astro";
import { collectionApp } from "../../../../writing/pages";
export const ALL: APIRoute = (context) => {
  const collection = context.params.collection;
  if (collection !== "posts" && collection !== "recipes")
    return new Response("Not found", { status: 404 });
  return collectionApp(context.url.origin, collection, context.cache).pages.api(context);
};
