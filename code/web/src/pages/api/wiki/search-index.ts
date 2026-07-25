import type { APIRoute } from "astro";
import { searchIndex } from "virtual:quiescent-wiki";

// Auth-guarded by the middleware (like every non-/auth route); the wiki may
// be private, so keep responses out of shared caches.
export const GET: APIRoute = async () => {
  return new Response(searchIndex, {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "private, max-age=300",
    },
  });
};
