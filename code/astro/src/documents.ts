import {createDocumentHandler,type DocumentHandlerOptions,type DocumentRecord,type Frontmatter} from '@quiescent/server/documents';
/** Astro's public cache contract, structural so other server consumers do not need Astro. */
export interface RouteCache {
  readonly enabled: boolean;
  set(options: {maxAge?:number;swr?:number;tags?:string[]} | false): void;
  invalidate(options: {path?:string;tags?:string[]}): Promise<void>;
}

export interface DocumentCacheOptions<T> {
 collection:string;
 origin:string;
 documentPath:(document:T)=>string;
 indexPaths?:string[];
 maxAge?:number;
 fetch?:(input:RequestInfo|URL,init?:RequestInit)=>Promise<Response>;
 /** Compatibility hook for existing route/media cache tags. */
 documentTag?:(id:string)=>string;
}
/** Whole-page Astro caching, invalidation and eager warming for any collection. */
export function astroDocumentCache<T extends {id:string}>(options:DocumentCacheOptions<T>) {
 const send=options.fetch ?? fetch;
 const indexTag=`quiescent:${options.collection}`;
 const collectionTag=`quiescent:collection:${options.collection}`;
 const documentTag=options.documentTag ?? ((id:string)=>`${indexTag}:${id}`);
 const indexes=options.indexPaths ?? [];
  async function warm(paths:string[],deletedPath?:string) {
    const unique=[...new Set(paths)];
    const fill=async(path:string)=>{
      const response=await send(new URL(path,options.origin),{redirect:'manual'});
      await response.arrayBuffer();
      if(response.status!==(path===deletedPath?404:200))
        throw new Error(`Page warming failed (${response.status})`);
      return response.headers.get('x-astro-cache') ?? response.headers.get('cf-cache-status');
    };
    for(const path of unique)await fill(path);
    // A completed render need not mean its CDN cache fill has settled. Confirm
    // the entries after the whole batch, while the writer still owns the wait.
    for(const path of unique) {
      for(let attempt=0;attempt<3;attempt++) {
        const state=await fill(path);
        if(!state || state==='HIT')break;
        if(attempt===2)throw new Error('Page cache did not retain the warmed response');
      }
    }
  }

 return {
  set(cache:RouteCache,id?:string){cache.set({maxAge:options.maxAge ?? 86400,tags:[id?documentTag(id):indexTag,collectionTag,'quiescent:public']});},
  async afterPublication(cache:RouteCache,document:T,deleted:boolean){
   if(!cache.enabled)return;
   await cache.invalidate({tags:[indexTag,documentTag(document.id)]});
   const path=options.documentPath(document);
   await warm([...indexes,path],deleted?path:undefined);
  },
  async refresh(cache:RouteCache,documents:T[]){
   if(!cache.enabled)return {refreshed:false,reason:'Caching is disabled in development.'};
   await cache.invalidate({tags:[collectionTag]});
   await warm([...indexes,...documents.map(options.documentPath)]);
   return {refreshed:true,pages:new Set([...indexes,...documents.map(options.documentPath)]).size};
  },
 };
}
/** A collection's private API and public page cache share one configuration. */
export function astroDocuments<T extends Frontmatter>(options:Omit<DocumentHandlerOptions<T>,'afterPublication'> & DocumentCacheOptions<DocumentRecord<T>>) {
 if(options.collection!==options.store.collection)throw new Error('Cache collection must match the document store');
 const pages=astroDocumentCache(options);
 return {...pages,api:({request,cache}:{request:Request;cache:RouteCache})=>createDocumentHandler({...options,afterPublication:(document,deleted)=>pages.afterPublication(cache,document,deleted)})(request)};
}
