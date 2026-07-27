import { graph } from "virtual:quiescent-wiki";
import type { APIRoute } from "astro";

export const GET: APIRoute = async () =>
  new Response(JSON.stringify(graph), {
    headers: { "Content-Type": "application/json", "Cache-Control": "private, max-age=300" },
  });
