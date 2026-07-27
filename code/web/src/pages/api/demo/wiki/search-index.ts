import { searchIndex } from "virtual:quiescent-wiki";
import type { APIRoute } from "astro";

export const GET: APIRoute = async () =>
  new Response(searchIndex, {
    headers: { "Content-Type": "application/json", "Cache-Control": "private, max-age=300" },
  });
