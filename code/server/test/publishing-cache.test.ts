import { describe, expect, test } from "bun:test";
import { cachedPublishingService, type PublishingService, type PublishingSnapshot, type PublishingSnapshotStore, type CacheScope } from "../src/publishing-cache";
import type { PostDraft } from "../src/publishing";
const draft=(head:string,title=head):PostDraft=>({post:{id:"post-1",title,description:"",slug:"a-story",body:{type:"doc",content:[]}},branch:"draft",headSha:head,state:"draft"});
function fixture() {
  const rows=new Map<CacheScope,{generation:number;snapshot:PublishingSnapshot|null}>();
  const store:PublishingSnapshotStore={
    async read(scope){const row=rows.get(scope);return row?.snapshot?structuredClone({...row.snapshot,generation:row.generation}):null;},
    async begin(scope){const row=rows.get(scope)??{generation:0,snapshot:null};row.generation++;rows.set(scope,row);return row.generation;},
    async commit(scope,generation,snapshot){const row=rows.get(scope);if(!row||row.generation!==generation)return false;row.generation++;row.snapshot=structuredClone(snapshot);return true;},
  };
  let scans=0;
  let current=draft("1");
  let published:PostDraft={...draft("0","Published"),branch:null,state:"published"};
  const unexpected=async():Promise<never>=>{throw new Error("unexpected call");};
  const raw:PublishingService={
    createPost:async()=>current,
    getDraft:async()=>current,
    saveDraft:async()=>current,
    publish:async()=>({post:published.post,headSha:published.headSha,publishedSha:published.headSha,state:"published"}),
    getPublished:async()=>published,
    listPublished:async()=>{scans++;return [published];},
    listPosts:async()=>{scans++;return [current];},
    findPostForEditing:unexpected,
  };
  const cache=cachedPublishingService(raw,store,async(a,b)=>Number(a)<=Number(b));
  return {cache,raw,store,rows,scans:()=>scans,setDraft:(p:PostDraft)=>{current=p;},setPublished:(p:PostDraft)=>{published=p;}};
}
describe("write-through publishing cache",()=>{
  test("prewarmed reads need no GitHub calls; saves update only private data and publishing updates both",async()=>{
    const f=fixture();await f.cache.warmCache();const scans=f.scans();
    expect((await f.cache.listPublished())[0]!.post.title).toBe("Published");
    expect((await f.cache.listPosts())[0]!.headSha).toBe("1");
    expect((await f.cache.findPostForEditing("a-story"))!.headSha).toBe("1");
    f.setDraft(draft("2","Private revision"));
    await f.cache.saveDraft({id:"post-1",branch:"draft",expectedHeadSha:"1",post:draft("2").post});
    expect((await f.cache.listPosts())[0]!.post.title).toBe("Private revision");
    expect((await f.cache.getPublished("post-1"))!.post.title).toBe("Published");
    f.setPublished({...draft("3","Now published"),branch:null,state:"published"});
    await f.cache.publish({id:"post-1",branch:"draft",expectedHeadSha:"2"});
    expect((await f.cache.listPublished())[0]!.post.title).toBe("Now published");
    expect((await f.cache.listPosts())[0]!.state).toBe("published");
    expect(f.scans()).toBe(scans);
  });
  test("creation prepares the author index without exposing drafts publicly",async()=>{
    const f=fixture();await f.cache.warmCache();const scans=f.scans();
    f.setDraft({...draft("2"),post:{...draft("2").post,id:"post-2",slug:null}});
    await f.cache.createPost();
    expect((await f.cache.findPostForEditing("post-2"))!.headSha).toBe("2");
    expect(await f.cache.getPublished("post-2")).toBeNull();
    expect(f.scans()).toBe(scans);
  });
  test("expired snapshots stay readable without putting maintenance on visitors",async()=>{
    const f=fixture();await f.cache.warmCache();const scans=f.scans();
    f.rows.get("published")!.snapshot!.expiresAt=0;
    f.raw.listPublished=async()=>{throw new Error("GitHub unavailable");};
    await expect(f.cache.warmCache()).rejects.toThrow("GitHub unavailable");
    expect((await f.cache.listPublished())[0]!.post.title).toBe("Published");
    expect(f.scans()).toBe(scans+1); // Only the explicit author refresh ran.
  });
  test("a delayed earlier save cannot replace a newer cached edit or resurrect a published draft",async()=>{
    const f=fixture();await f.cache.warmCache();
    f.setDraft(draft("3"));await f.cache.saveDraft({id:"post-1",branch:"draft",expectedHeadSha:"2",post:draft("3").post});
    f.setDraft(draft("2"));await f.cache.saveDraft({id:"post-1",branch:"draft",expectedHeadSha:"1",post:draft("2").post});
    expect((await f.cache.listPosts())[0]!.headSha).toBe("3");
    f.setPublished({...draft("4"),branch:null,state:"published"});await f.cache.publish({id:"post-1",branch:"draft",expectedHeadSha:"3"});
    f.setDraft(draft("3"));await f.cache.saveDraft({id:"post-1",branch:"draft",expectedHeadSha:"2",post:draft("3").post});
    expect((await f.cache.listPosts())[0]!.state).toBe("published");
  });
  test("failed writes leave the prepared cache unchanged",async()=>{
    const f=fixture();await f.cache.warmCache();f.raw.saveDraft=async()=>{throw new Error("conflict");};
    await expect(f.cache.saveDraft({id:"post-1",branch:"draft",expectedHeadSha:"0",post:draft("2").post})).rejects.toThrow("conflict");
    expect((await f.cache.listPosts())[0]!.headSha).toBe("1");
  });
  test("public cache reads never discover branches, including when the cache is missing",async()=>{
    const f=fixture();await expect(f.cache.listPublished()).rejects.toThrow("not been initialized");expect(f.scans()).toBe(0);
  });
  test("generation fencing rejects an outdated rebuild after an intervening write",async()=>{
    const f=fixture();await f.cache.warmCache();const old=await f.store.begin("author");
    f.setDraft(draft("2"));await f.cache.saveDraft({id:"post-1",branch:"draft",expectedHeadSha:"1",post:draft("2").post});
    expect(await f.store.commit("author",old,{posts:[draft("1")],expiresAt:0})).toBe(false);
    expect((await f.cache.listPosts())[0]!.headSha).toBe("2");
  });
});
