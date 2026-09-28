import type { APIRoute } from "astro";
import { createWritingHandler, writingErrorResponse } from "@quiescent/server";
import { writingApp, localAuthor } from "../../../writing/app";
export const prerender=false;
export const ALL:APIRoute=async({request,locals})=>{
  try {
    const env=locals.runtime.env;
    return await createWritingHandler({...writingApp(env),authorize:r=>localAuthor(r,env)})(request);
  } catch(error){return writingErrorResponse(error);}
};
