import type { APIRoute } from "astro";
import { publishedPage, writingErrorResponse } from "@quiescent/server";
import { writingApp, writingAuthor } from "../../writing/app";
export const prerender=false;
export const GET:APIRoute=async({params,locals,request})=>{
  try {return await publishedPage(writingApp(locals.runtime.env).service,params.path?.split('/')[0],{canEdit:await writingAuthor(request,locals.runtime.env)});}
  catch(error){return writingErrorResponse(error);}
};
