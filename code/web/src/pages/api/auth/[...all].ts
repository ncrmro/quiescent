import { env } from "cloudflare:workers";
import type { APIRoute } from "astro";
import { writingAuth } from "../../../writing/auth";
export const prerender=false;
export const ALL:APIRoute=({request}) => {
  if (env.WRITING_TEST !== "true") return new Response("Not found",{status:404});
  return writingAuth(env).handler(request);
};
