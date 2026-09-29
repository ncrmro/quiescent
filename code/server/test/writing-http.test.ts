import { describe, expect, test } from "bun:test";
import { ConflictError, ForgeError } from "@quiescent/git";
import { createWritingHandler, publishedMedia, publishedPage } from "../src/writing-http.ts";
import { PublishingError, type createPublishingService, type PostDraft } from "../src/publishing.ts";
import { localR2Media, type MediaStorage } from "../src/media.ts";

type Service=ReturnType<typeof createPublishingService>;
const id="11111111-1111-4111-8111-111111111111";
const asset="a".repeat(64);
function post(withImage=false):PostDraft{return {post:{id,title:"Tea & <script>",description:"A quiet morning",slug:"tea",body:{type:"doc",content:withImage?[{type:"image",attrs:{src:`/media/${id}/${asset}`,alt:"Tea"}}]:[{type:"paragraph"}]}},branch:null,headSha:"b".repeat(40),state:"published"};}
function service(overrides:Partial<Service>={}):Service {
  const unexpected=async()=>{throw new Error("Unexpected service call");};
  return {listPosts:unexpected,createPost:unexpected,getDraft:unexpected,saveDraft:unexpected,publish:unexpected,getPublished:unexpected,listPublished:unexpected,...overrides} as Service;
}
function media():MediaStorage{return localR2Media({async get(){return null;},async put(){}});}
function request(path="/posts",method="GET",data?:unknown,origin:string|null="http://localhost"){
  const headers=new Headers();if(origin)headers.set("Origin",origin);
  if(data!==undefined)headers.set("Content-Type","application/json");
  return new Request(`http://localhost/api/writing${path}`,{method,headers,...(data!==undefined?{body:typeof data==="string"?data:JSON.stringify(data)}:{})});
}

describe("writing HTTP boundary",()=>{
  test("authorization precedes every editor route, including draft media and revision queries",async()=>{
    const handler=createWritingHandler({service:service(),media:media(),authorize:()=>false});
    for(const req of [request(),request(`/posts/${id}?branch=main`),request(`/media/${id}/${asset}`),request(`/posts/${id}/publish`,"POST",{})]){
      expect((await handler(req)).status).toBe(403);
    }
  });
  test("mutations require an exact same-origin header before accessing service",async()=>{
    const handler=createWritingHandler({service:service(),media:media(),authorize:()=>true});
    for(const origin of [null,"https://evil.example","http://localhost.evil.example"]){
      expect((await handler(request("/posts","POST",undefined,origin))).status).toBe(403);
    }
  });
  test("autosave forwards the expected revision and marks responses non-cacheable",async()=>{
    let captured:unknown;
    const document=post();
    const handler=createWritingHandler({service:service({saveDraft:async value=>{captured=value;return document;}}),media:media(),authorize:()=>true});
    const response=await handler(request(`/posts/${id}`,"PUT",{branch:"draft",expectedHeadSha:"old",post:document.post}));
    expect(response.status).toBe(200);expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(captured).toEqual({id,branch:"draft",expectedHeadSha:"old",post:document.post});
  });
  test("invalid JSON and overlarge payloads never invoke save",async()=>{
    const handler=createWritingHandler({service:service(),media:media(),authorize:()=>true});
    expect((await handler(request(`/posts/${id}`,"PUT","{"))).status).toBe(400);
    expect((await handler(request(`/posts/${id}`,"PUT"," ".repeat(1024*1024+1)))).status).toBe(400);
  });
  test("service rejects arbitrary draft refs and internal errors never leak forge credentials",async()=>{
    const handler=createWritingHandler({service:service({getDraft:async(_id,branch)=>{
      expect(branch).toBe("main");throw new PublishingError("Invalid draft","invalid");
    }}),media:media(),authorize:()=>true});
    expect((await handler(request(`/posts/${id}?branch=main`))).status).toBe(400);
    for(const [error,status] of [[new ConflictError("draft","old","new"),409],[new ForgeError("secret-token",403,"https://secret"),502],[new ForgeError("secret-token",409,"https://secret"),409],[new Error("secret-token"),500]] as const){
      const failing=createWritingHandler({service:service({listPosts:async()=>{throw error;}}),media:media(),authorize:()=>true});
      const response=await failing(request());expect(response.status).toBe(status);expect(await response.text()).not.toContain("secret");
    }
  });
  test("public image requests require an exact reference in published content",async()=>{
    let reads=0;const storage=media();storage.read=async()=>{reads++;return {body:new Response("image").body!,size:5,contentType:"image/png"};};
    for(const published of [null,post(false)]){
      expect((await publishedMedia(service({getPublished:async()=>published}),storage,id,asset)).status).toBe(404);
    }
    expect(reads).toBe(0);
    const published=service({getPublished:async()=>post(true)});
    expect((await publishedMedia(published,storage,id,"other-asset")).status).toBe(404);
    const response=await publishedMedia(published,storage,id,asset);
    expect(response.status).toBe(200);expect(reads).toBe(1);
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });
  test("reader output identifies the actual revision and escapes untrusted titles",async()=>{
    const response=await publishedPage(service({getPublished:async()=>post()}),id);
    expect(response.headers.get("X-Quiescent-Revision")).toBe(post().headSha);
    const html=await response.text();expect(html).toContain("Tea &amp; &lt;script&gt;");expect(html).not.toContain("<script>");
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    const malicious=post();malicious.post.slug='" onclick="alert(1)';
    const index=await publishedPage(service({listPublished:async()=>[malicious]}));
    const indexHtml=await index.text();
    expect(indexHtml).not.toContain('" onclick="');
    expect(indexHtml).toContain('%22%20onclick%3D%22alert(1)');
  });
});
