import type { APIRoute } from "astro";
import { writingAuth } from "../../../writing/auth";
export const prerender=false;
export const ALL:APIRoute=({request,locals}) => {
  if (locals.runtime.env.WRITING_TEST !== "true") return new Response("Not found",{status:404});
  return writingAuth(locals.runtime.env).handler(request);
};
