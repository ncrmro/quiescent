import { env } from "cloudflare:workers";
import type { APIRoute } from "astro";
import { publishedPage, writingErrorResponse } from "@quiescent/server";
import { writingApp, writingAuthor } from "../../writing/app";
export const prerender=false;
export const GET:APIRoute=async({params,request})=>{
  try {return await publishedPage(writingApp(env).service,params.path?.split('/')[0],{canEdit:await writingAuthor(request,env)});}
  catch(error){return writingErrorResponse(error);}
};
