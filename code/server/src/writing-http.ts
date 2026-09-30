import { imageReferences, renderDocument } from "@quiescent/editor/document";
import { ConflictError, ForgeError } from "@quiescent/git";
import { PublishingError, type createPublishingService, type DraftSelection, type PostDocument } from "./publishing.ts";
import { MediaError, type MediaStorage } from "./media.ts";

export class WritingConfigurationError extends Error {}
type Service = ReturnType<typeof createPublishingService>;
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{"Cache-Control":"no-store"}});
async function payload(request:Request):Promise<Record<string,unknown>> {
  if(!request.body)throw new PublishingError("Request body missing","invalid");
  const reader=request.body.getReader(); const chunks:Uint8Array[]=[];let size=0;
  try { while(true){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.length;
    if(size>1024*1024){await reader.cancel();throw new PublishingError("This post is too large","invalid");}chunks.push(chunk.value);}
  } finally {reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
  const result:unknown=JSON.parse(new TextDecoder().decode(bytes));
  if(!result || typeof result!=="object" || Array.isArray(result))throw new PublishingError("Invalid request","invalid");
  return result as Record<string,unknown>;
}
function selection(id:string,value:Record<string,unknown>):DraftSelection {
  if(typeof value.branch!=="string" || typeof value.expectedHeadSha!=="string") throw new PublishingError("Draft revision missing","invalid");
  return {id,branch:value.branch,expectedHeadSha:value.expectedHeadSha};
}
/** Thin host routes delegate all post/media behavior and error translation here. */
export function createWritingHandler(options:{service:Service;media:MediaStorage;authorize:(request:Request)=>boolean|Promise<boolean>;apiBase?:string; afterPublication?:(post:PostDocument,deleted:boolean)=>Promise<void>}) {
  const {service,media}=options; const base=options.apiBase ?? "/api/writing";
  return async(request:Request):Promise<Response>=>{
    try {
      if(!await options.authorize(request))return json({error:"This editor is available only to the authorized author."},403);
      const url=new URL(request.url);
      if(!["GET","HEAD"].includes(request.method) && request.headers.get("Origin")!==url.origin)return json({error:"Invalid request origin."},403);
      if (!url.pathname.startsWith(`${base}/`)) return json({error:"Not found"},404);
      const parts=url.pathname.slice(base.length).split("/").filter(Boolean);
      const [resource,id,action,asset,operation]=parts;
      if(parts.length>5 || (resource!=="posts" && parts.length>3) || (resource==="posts" && action!=="uploads" && parts.length>3))return json({error:"Not found"},404);
      if(resource==="posts" && !id){
        if(request.method==="GET")return json(await service.listPosts());
        if(request.method==="POST")return json(await service.createPost(),201);
      }
      if(resource==="published" && id && request.method==="GET"){
        const post=await service.getPublished(id);return post ? json(post):json({error:"Post not found"},404);
      }
      if(resource==="media" && id && action && request.method==="GET"){
        // Author-only access includes just-confirmed images before autosave.
        // Reading an image must not create a new draft branch.
        return mediaResponse(await media.read(id,action));
      }
      if(resource==="posts" && id){
        if(!action && request.method==="GET")return json(await service.getDraft(id,url.searchParams.get("branch") ?? undefined));
        if(!action && request.method==="PUT"){
          const data=await payload(request);
          if(!data.post || typeof data.post!=="object")throw new PublishingError("Post missing","invalid");
          return json(await service.saveDraft({...selection(id,data),post:data.post as PostDocument}));
        }
        if(action==="publish" && request.method==="POST") {
          const result=await service.publish(selection(id,await payload(request)));
          try { await options.afterPublication?.(result.post,false); }
          catch { return json({...result,cacheWarning:"Published on GitHub, but page warming failed. Refresh the site cache before sharing."}); }
          return json(result);
        }
        if(!action && request.method==="DELETE") {
          const data=await payload(request);
          if(typeof data.expectedHeadSha!=="string" || (data.branch!=null && typeof data.branch!=="string")) throw new PublishingError("Post revision missing","invalid");
          const result=await service.deletePost({id,expectedHeadSha:data.expectedHeadSha,branch:data.branch as string|null|undefined});
          try { await options.afterPublication?.(result.post,true); }
          catch { return json({...result,cacheWarning:"Deleted on GitHub, but cache removal failed. Refresh the site cache before sharing."}); }
          return json(result);
        }
        if(action==="uploads"){
          // Resolve the post before accepting media; arbitrary bucket prefixes aren't API inputs.
          await service.getDraft(id);
          if(!asset && request.method==="POST"){
            const data=await payload(request);
            if(typeof data.contentType!=="string" || typeof data.size!=="number")throw new MediaError("Image metadata missing");
            return json(await media.prepare(id,data.contentType,data.size));
          }
          if(asset && operation==="confirm" && request.method==="POST")return json(await media.confirm(id,asset));
          if(asset && !operation && request.method==="PUT" && media.uploadLocal){await media.uploadLocal(id,asset,request);return json({ok:true});}
        }
      }
      return json({error:"Not found"},404);
    } catch(error) {return writingErrorResponse(error);}
  };
}
export function writingErrorResponse(error:unknown):Response {
  if(error instanceof WritingConfigurationError)return json({error:error.message},503);
  if(error instanceof PublishingError)return json({error:error.message},error.code==="conflict"?409:error.code==="not_found"?404:400);
  if(error instanceof MediaError)return json({error:error.message},error.status);
  if(error instanceof ConflictError)return json({error:"This draft has newer changes. Your writing is still in this browser; reopen it before saving."},409);
  if(error instanceof ForgeError){
    const status=error.status;
    return json({error:status===409 || status===422?"This post could not be merged. Your draft is safe. Reopen it and try again.":status===401 || status===403?"GitHub access was denied. Check the server credential or try again after its rate limit resets.":"GitHub is unavailable. Your draft has not been discarded; please retry."},status===409 || status===422?409:502);
  }
  if(error instanceof SyntaxError)return json({error:"Invalid document"},400);
  return json({error:"The operation could not finish. Your writing has not been discarded."},500);
}
function mediaResponse(object:Awaited<ReturnType<MediaStorage["read"]>>):Response {
  return object ? new Response(object.body,{headers:{"Content-Type":object.contentType,"Content-Length":String(object.size),"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}}):json({error:"Image not found"},404);
}
export async function publishedMedia(service:Service,media:MediaStorage,id:string,assetId:string):Promise<Response>{
  const post=await service.getPublished(id);
  if(!post || !imageReferences(post.post.body).some(r=>r.postId===id && r.assetId===assetId))return json({error:"Image not found"},404);
  return mediaResponse(await media.read(id,assetId));
}
const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export async function publishedPage(service:Service,id?:string,options:{canEdit?:boolean}={}):Promise<Response>{
  const post=id?await service.getPublished(id):null;
  if(id && !post)return new Response("Not found",{status:404});
  const title=post?.post.title ?? "Stories";
  const edit=(slug:string)=>options.canEdit ? `<a class="edit" href="/posts/${encodeURIComponent(slug)}/edit">Edit</a>` : "";
  const content=post ? `<nav><a href="/read">All stories</a>${edit(post.post.slug ?? post.post.id)}</nav><h1>${escape(title)}</h1><p>${escape(post.post.description)}</p>${renderDocument(post.post.body)}`
    : `<h1>Stories</h1>${(await service.listPublished()).map(p=>`<article><h2><a href="/read/${p.post.id}/${encodeURIComponent(p.post.slug ?? "")}">${escape(p.post.title)}</a></h2><p>${escape(p.post.description)}</p>${edit(p.post.slug ?? p.post.id)}</article>`).join("")}`;
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escape(title)}</title><style>body{max-width:720px;margin:4rem auto;padding:0 1.5rem;font:19px/1.7 Georgia,serif;color:#293530;background:#faf9f6}h1,h2{line-height:1.2}a{color:#315c4c}nav{display:flex;align-items:center;justify-content:space-between}.edit{display:inline-block;padding:.25rem .85rem;border:1px solid #bac7be;border-radius:6px;text-decoration:none;font:16px/1.6 system-ui,sans-serif}img{max-width:100%;height:auto;border-radius:8px}blockquote{border-left:3px solid #b4c4b4;padding-left:1em}</style></head><body><main>${content}</main></body></html>`,{headers:{"Content-Type":"text/html; charset=utf-8","Cache-Control":"private, no-store","Vary":"Cookie","X-Quiescent-Revision":post?.headSha ?? "","Content-Security-Policy":"default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'","X-Content-Type-Options":"nosniff"}});
}
