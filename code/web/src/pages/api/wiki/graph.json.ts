import type { APIRoute } from "astro";
import { graph } from "virtual:quiescent-wiki";

export const GET: APIRoute = async () => {
  return new Response(JSON.stringify(graph), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "private, max-age=300",
    },
  });
};
