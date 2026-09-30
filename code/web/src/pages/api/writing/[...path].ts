import { env } from "cloudflare:workers";
import type { APIRoute } from "astro";
import { createWritingHandler, writingErrorResponse } from "@quiescent/server";
import { writingApp, writingAuthor } from "../../../writing/app";
export const prerender=false;
export const ALL:APIRoute=async({request})=>{
  try {

    const app=writingApp(env);
    if (new URL(request.url).pathname === "/api/writing/cache/refresh") {
      if (request.method !== "POST") return new Response("Method not allowed",{status:405});
      if (!await writingAuthor(request,env) || request.headers.get("Origin") !== new URL(request.url).origin) return new Response("Unauthorized",{status:403});
      await app.service.warmCache();
      return Response.json({refreshed:true});
    }
    return await createWritingHandler({...app,authorize:r=>writingAuthor(r,env)})(request);
  } catch(error){return writingErrorResponse(error);}
};
