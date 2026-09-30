import type { createPublishingService, PostDocument } from './publishing.ts';
import type { MediaStorage } from './media.ts';
import { createWritingHandler, writingErrorResponse } from './writing-http.ts';

/** Astro's public cache contract, structural so other server consumers do not need Astro. */
export interface RouteCache {
  readonly enabled: boolean;
  set(options: {maxAge?:number;swr?:number;tags?:string[]} | false): void;
  invalidate(options: {path?:string;tags?:string[]}): Promise<void>;
}
export const WRITING_CACHE_SECONDS=86400;
export const publicationTag=(id:string)=>`quiescent:post:${id}`;
export const readerPath=(post:Pick<PostDocument,'id'|'slug'>)=>`/read/${post.id}/${encodeURIComponent(post.slug ?? '')}`;
export function cachePublication(cache:RouteCache,id?:string) {
  cache.set({maxAge:WRITING_CACHE_SECONDS,tags:[id?publicationTag(id):'quiescent:posts','quiescent:public']});
}
type Context={request:Request;cache:RouteCache};
type Options={service:ReturnType<typeof createPublishingService>;media:MediaStorage;authorize:(request:Request)=>boolean|Promise<boolean>;origin:string;fetch?:(input:RequestInfo|URL,init?:RequestInit)=>Promise<Response>};
/** The host mounts one handler. Publication, invalidation and eager warming stay together. */
export function astroWriting(options:Options) {
  const send=options.fetch ?? fetch;
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
  async function afterPublication(cache:RouteCache,post:PostDocument,deleted:boolean) {
    if (!cache.enabled) return;
    // The post tag also covers its media so removed references stop being publicly served.
    await cache.invalidate({tags:['quiescent:posts',publicationTag(post.id)]});
    await warm(['/', '/read',readerPath(post)],deleted?readerPath(post):undefined);
  }
  return {
    async api(context:Context):Promise<Response> {
      try {
        if (new URL(context.request.url).pathname==='/api/writing/cache/refresh') {
          if(context.request.method!=='POST')return new Response('Method not allowed',{status:405});
          if(!await options.authorize(context.request) || context.request.headers.get('Origin')!==options.origin)
            return new Response('Unauthorized',{status:403});
          if (!context.cache.enabled) return Response.json({refreshed:false,reason:'Caching is disabled in development.'});
          const posts=await options.service.listPublished();
          try {await context.cache.invalidate({tags:['quiescent:public']});}
          catch(error){console.error('quiescent:purge',error instanceof Error?error.message:'Unknown cache error');throw error;}
          await warm(['/', '/read',...posts.map(p=>readerPath(p.post))]);
          return Response.json({refreshed:true,pages:posts.length+2});
        }
        return await createWritingHandler({...options,afterPublication:(post,deleted)=>afterPublication(context.cache,post,deleted)})(context.request);
      } catch(error) {return writingErrorResponse(error);}
    },
  };
}

/** Run in page frontmatter, before Astro starts streaming any HTML. */
export async function prepareReader(context: {cache:RouteCache;response:{headers:Headers}},service:Options['service'],id?:string) {
  const post=id?await service.getPublished(id):null;
  cachePublication(context.cache,id);
  context.response.headers.set('Cache-Control','public, max-age=0, must-revalidate');
  context.response.headers.set('X-Quiescent-Rendered',crypto.randomUUID());
  if(id && !post)return new Response('Not found',{status:404,headers:context.response.headers});
  context.response.headers.set('X-Quiescent-Revision',post?.headSha ?? '');
  return {post,posts:post?[post]:await service.listPublished()};
}
