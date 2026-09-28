import type { APIRoute } from "astro";
import { publishedMedia, writingErrorResponse } from "@quiescent/server";
import { writingApp } from "../../writing/app";
export const prerender=false;
export const GET:APIRoute=async({params,locals})=>{
  try {
    const [id,asset,...extra]=(params.path??'').split('/');
    if(!id || !asset || extra.length)return new Response('Not found',{status:404});
    const {service,media}=writingApp(locals.runtime.env);return await publishedMedia(service,media,id,asset);
  }catch(error){return writingErrorResponse(error);}
};
