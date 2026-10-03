import type { DocumentQuery } from "@quiescent/server";
import type { APIContext } from "astro";
import type { Collection } from "./collections";
import { collectionApp } from "./pages";
export async function reader(
  context: Pick<APIContext, "url" | "cache"> & { response: { headers: Headers } },
  collection: Collection,
  slug?: string,
) {
  const { service, pages } = collectionApp(context.url.origin, collection, context.cache);
  const filter = recipeFilter(context.url, collection, slug);
  if (filter instanceof Response) return filter;
  const result = slug
    ? await service.getPublishedBySlugWithStatus(slug)
    : await service.listPublishedWithStatus(filter.query);
  const document = "document" in result ? result.document : null;
  const documents = "documents" in result ? result.documents : [];
  pages.set(context.cache, document?.document.id, result.cache);
  if (filter.active) context.cache.set(false);
  pages.setReaderHeaders(context.response.headers, document?.headSha);
  if (slug && !document)
    return new Response("Not found", { status: 404, headers: context.response.headers });
  return { post: document, posts: document ? [document] : documents, collection };
}

function recipeFilter(url: URL, collection: Collection, slug?: string) {
  const minutes =
    collection === "recipes" && !slug ? url.searchParams.get("maxMinutes") || null : null;
  if (minutes !== null && (!/^\d+$/.test(minutes) || !Number.isSafeInteger(Number(minutes))))
    return new Response("Invalid preparation time", { status: 400 });
  const query: DocumentQuery =
    minutes === null
      ? {}
      : {
          where: [{ field: "preparationMinutes", op: "lte", value: Number(minutes) }],
          orderBy: [{ field: "preparationMinutes", direction: "asc" }],
        };
  return { query, active: minutes !== null };
}
