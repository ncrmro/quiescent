import { timingSafeEqual } from "node:crypto";
import { createForge, requirePublishingForge } from "@quiescent/git";
import { createPublishingService, localR2Media, r2Media, WritingConfigurationError, PublishingError, type MediaStorage } from "@quiescent/server";
import { imageReferences } from "@quiescent/editor/document";

export type WritingEnv = Partial<WritingBindings> & Partial<HostedWritingBindings> & {
  SERVICE_TOKEN?: string;
  WRITING_PASSWORD?: string;
  WRITING_ALLOWED_ORIGINS?: string;
  R2_ACCOUNT_ID?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
};
export function localAuthor(request:Request,env:WritingEnv) {
  const url=new URL(request.url);
  const allowed = (env.WRITING_ALLOWED_ORIGINS ?? "").split(",").map(value => value.trim());
  return env.WRITING_LOCAL === "true" && (["localhost","127.0.0.1","[::1]"].includes(url.hostname) || allowed.includes(url.origin))
    && !["cross-site"].includes(request.headers.get("Sec-Fetch-Site") ?? "");
}
/** Password protection for the isolated hosted test, using the browser login dialog. */
export function writingAuthor(request:Request, env:WritingEnv) {
  if (env.WRITING_TEST !== "true") return localAuthor(request, env);
  if (!env.WRITING_PASSWORD || new URL(request.url).protocol !== "https:") return false;
  const expected = new TextEncoder().encode(`Basic ${btoa(`writer:${env.WRITING_PASSWORD}`)}`);
  const supplied = new TextEncoder().encode(request.headers.get("Authorization") ?? "");
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}
export function writingApp(env:WritingEnv) {
  if(!env.SERVICE_TOKEN)throw new WritingConfigurationError("Set SERVICE_TOKEN in code/web/.dev.vars to connect the private writing repository.");
  if(!env.WRITING_REPO_OWNER || !env.WRITING_REPO_NAME)throw new WritingConfigurationError("Writing repository is not configured.");
  const forge=requirePublishingForge(createForge({kind:"github",owner:env.WRITING_REPO_OWNER,repo:env.WRITING_REPO_NAME,token:env.SERVICE_TOKEN}));
  let media:MediaStorage;
  const remoteFields=[env.R2_ACCOUNT_ID,env.R2_ACCESS_KEY_ID,env.R2_SECRET_ACCESS_KEY];
  if(remoteFields.some(Boolean) && !remoteFields.every(Boolean))throw new WritingConfigurationError("Provide all R2 credentials or leave all unset for local emulation.");
  if(env.R2_ACCOUNT_ID && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.WRITING_R2_BUCKET){
    media=r2Media({accountId:env.R2_ACCOUNT_ID,bucket:env.WRITING_R2_BUCKET,accessKeyId:env.R2_ACCESS_KEY_ID,secretAccessKey:env.R2_SECRET_ACCESS_KEY});
  } else {
    if(!env.WRITING_MEDIA)throw new WritingConfigurationError("Writing media storage is not configured.");
    media=localR2Media(env.WRITING_MEDIA);
  }
  const service=createPublishingService({forge,author:{name:env.WRITING_AUTHOR_NAME ?? "Local writer",email:env.WRITING_AUTHOR_EMAIL ?? "writer@quiescent.invalid"},verifyMedia:async post=>{
    for(const ref of imageReferences(post.body)){
      if(ref.postId!==post.id)throw new PublishingError("Images must belong to this post.","invalid");
      await media.verify(ref.postId,ref.assetId);
    }
  }});
  return {service,media};
}
