import {type createDocumentStore,type Frontmatter,type DocumentRecord,type DocumentInput,DocumentError} from './document-store.ts';
import {json,payload,documentErrorResponse} from './http.ts';
export interface DocumentHandlerOptions<T extends Frontmatter> {
 store:ReturnType<typeof createDocumentStore<T>>;
 authorize:(request:Request)=>boolean|Promise<boolean>;
 apiBase?:string;
 afterPublication?:(document:DocumentRecord<T>,deleted:boolean)=>Promise<void>;
}
/** One private CRUD endpoint for a configured collection. Public reads use the store directly. */
export function createDocumentHandler<T extends Frontmatter>(options:DocumentHandlerOptions<T>) {
 const {store}=options;const base=(options.apiBase ?? '/api/documents').replace(/\/$/,'');
 const selection=(id:string,data:Record<string,unknown>)=>{
  if(typeof data.branch!=='string' || typeof data.expectedHeadSha!=='string')throw new DocumentError('Draft revision missing','invalid');
  return {id,branch:data.branch,expectedHeadSha:data.expectedHeadSha};
 };
 return async(request:Request):Promise<Response>=>{
  try {
   const url=new URL(request.url);
   if(!await options.authorize(request))return json({error:'Unauthorized'},403);
   if(!['GET','HEAD'].includes(request.method) && request.headers.get('Origin')!==url.origin)return json({error:'Invalid request origin'},403);
   if(url.pathname!==base && !url.pathname.startsWith(base+'/'))return json({error:'Not found'},404);
   const parts=url.pathname.slice(base.length).split('/').filter(Boolean);
   const [id,action]=parts;
   if(parts.length>2)return json({error:'Not found'},404);
   if(!id && request.method==='GET')return json(await store.listDocuments());
   if(!id && request.method==='POST')return json(await store.createDocument(await payload(request) as unknown as DocumentInput<T>),201);
   if(id==='schema' && !action && request.method==='GET')return json(store.schema);
   if(!id)return json({error:'Not found'},404);
   if(!action && request.method==='GET')return json(await store.getDraft(id,url.searchParams.get('branch') ?? undefined));
   if(!action && request.method==='PUT'){
    const data=await payload(request);
    return json(await store.saveDraft({...selection(id,data),document:data.document as DocumentInput<T>}));
   }
   if(action==='publish' && request.method==='POST'){
    const result=await store.publish(selection(id,await payload(request)));
    try{await options.afterPublication?.(result.document,false);}catch{return json({...result,cacheWarning:'Published on GitHub, but page warming failed. Refresh the site cache before sharing.'});}
    return json(result);
   }
   if(!action && request.method==='DELETE'){
    const data=await payload(request);
    if(typeof data.expectedHeadSha!=='string' || (data.branch!=null && typeof data.branch!=='string'))throw new DocumentError('Document revision missing','invalid');
    const result=await store.deleteDocument({id,expectedHeadSha:data.expectedHeadSha,branch:data.branch as string|null|undefined});
    try{await options.afterPublication?.(result.document,true);}catch{return json({...result,cacheWarning:'Deleted on GitHub, but cache removal failed. Refresh the site cache before sharing.'});}
    return json(result);
   }
   return json({error:'Not found'},404);
  }catch(error){return documentErrorResponse(error);}
 };
}
