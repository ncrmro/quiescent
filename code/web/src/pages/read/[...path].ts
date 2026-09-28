import type { APIRoute } from "astro";
import { publishedPage, writingErrorResponse } from "@quiescent/server";
import { writingApp } from "../../writing/app";
export const prerender=false;
export const GET:APIRoute=async({params,locals})=>{
  try {return await publishedPage(writingApp(locals.runtime.env).service,params.path?.split('/')[0]);}
  catch(error){return writingErrorResponse(error);}
};
