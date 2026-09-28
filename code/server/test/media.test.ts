import { describe, expect, test } from "bun:test";
import { localR2Media, r2Media, MAX_IMAGE_SIZE, type MediaBucket } from "../src/media.ts";

const png = new Uint8Array([137,80,78,71,13,10,26,10,1]);
function bucket() {
  const objects = new Map<string, { bytes: ArrayBuffer; type: string }>();
  const storage: MediaBucket = {
    async get(key) { const value=objects.get(key); return value ? {arrayBuffer:async()=>value.bytes.slice(0),size:value.bytes.byteLength,httpMetadata:{contentType:value.type}}:null; },
    async put(key,bytes,options) { objects.set(key,{bytes:bytes.slice(0),type:options.httpMetadata.contentType}); },
  };
  return {storage,objects};
}
function upload(bytes:Uint8Array, type="image/png") { return new Request("http://localhost/upload",{method:"PUT",headers:{"Content-Type":type},body:new Uint8Array(bytes).buffer}); }

describe("image storage",()=>{
  test("finalized references survive staging URL replays without changing original bytes",async()=>{
    const {storage}=bucket(); const media=localR2Media(storage);
    const prepared=await media.prepare("post","image/png",png.length);
    await media.uploadLocal!("post",prepared.assetId,upload(png));
    const first=await media.confirm("post",prepared.assetId); const asset=first.src.split("/").at(-1)!;
    expect(asset).toMatch(/^[a-f0-9]{64}$/);
    await media.uploadLocal!("post",prepared.assetId,upload(new Uint8Array([...png,2])));
    expect((await media.confirm("post",prepared.assetId)).src).not.toBe(first.src);
    expect(new Uint8Array(await new Response((await media.read("post",asset))!.body).arrayBuffer())).toEqual(png);
    await media.verify("post",asset);
    await expect(media.verify("another-post",asset)).rejects.toMatchObject({status:409});
  });
  test("rejects invalid media declarations, oversized streams, and spoofed magic bytes",async()=>{
    const {storage}=bucket(); const media=localR2Media(storage);
    await expect(media.prepare("post","image/svg+xml",12)).rejects.toMatchObject({status:400});
    await expect(media.prepare("post","image/png",MAX_IMAGE_SIZE+1)).rejects.toMatchObject({status:400});
    await expect(media.uploadLocal!("post","asset",upload(new Uint8Array(MAX_IMAGE_SIZE+1)))).rejects.toMatchObject({status:413});
    await expect(media.uploadLocal!("post","asset",upload(new TextEncoder().encode("<script>")))).rejects.toMatchObject({status:400});
    await expect(media.confirm("post","asset")).rejects.toMatchObject({status:404});
  });
  test("confirmation independently validates direct-upload objects",async()=>{
    const {storage,objects}=bucket(); const media=localR2Media(storage);
    objects.set("uploads/post/asset",{bytes:new TextEncoder().encode("not an image").buffer,type:"image/png"});
    await expect(media.confirm("post","asset")).rejects.toMatchObject({status:400});
    expect([...objects.keys()]).toEqual(["uploads/post/asset"]);
    await expect(media.prepare("../outside","image/png",png.length)).rejects.toMatchObject({status:400});
  });
  test("R2 presigns one staging object with signed content type and short expiry",async()=>{
    const secret="private-server-secret";
    const media=r2Media({accountId:"a".repeat(32),bucket:"writing-test",accessKeyId:"test-access-id",secretAccessKey:secret});
    const result=await media.prepare("post","image/png",png.length); const url=new URL(result.url);
    expect(url.pathname).toBe(`/writing-test/uploads/post/${result.assetId}`);
    expect(url.searchParams.get("X-Amz-Expires")).toBe("300");
    expect(url.searchParams.get("X-Amz-SignedHeaders")?.split(";")).toContain("content-type");
    expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[a-f0-9]{64}$/);
    expect(result.headers).toEqual({"Content-Type":"image/png"});
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(result.headers).not.toHaveProperty("Authorization");
  });
  test("remote confirmation seals bytes under their digest using server credentials",async()=>{
    const requests:Request[]=[];
    const media=r2Media({accountId:"a".repeat(32),bucket:"writing-test",accessKeyId:"test-access-id",secretAccessKey:"private-secret",fetch:(async(input)=>{
      const request=input as Request;requests.push(request);
      return request.method==="GET"?new Response(png,{headers:{"Content-Length":String(png.length),"Content-Type":"image/png"}}):new Response(null,{status:200});
    }) as typeof fetch});
    const result=await media.confirm("post","staged");
    expect(requests.map(r=>r.method)).toEqual(["GET","PUT"]);
    expect(new URL(requests[1]!.url).pathname).toBe(`/writing-test/images/post/${result.src.split("/").at(-1)}`);
    expect(requests[1]!.headers.get("Authorization")).toContain("AWS4-HMAC-SHA256");
    expect(new Uint8Array(await requests[1]!.arrayBuffer())).toEqual(png);
  });
});
