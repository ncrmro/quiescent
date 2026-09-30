import { hostedMedia } from "quiescent:runtime";
export { writingAuthor } from "./auth";
import { createForge, requirePublishingForge } from "@quiescent/git";
import { createPublishingService, localR2Media, r2Media, WritingConfigurationError, PublishingError, postImageReferences, type MediaStorage } from "@quiescent/server";

export type WritingEnv = Partial<WritingBindings> & Partial<HostedWritingBindings> & {
  SERVICE_TOKEN?: string;
  WRITING_ALLOWED_ORIGINS?: string;
  R2_ACCOUNT_ID?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
};
export function writingApp(env:WritingEnv) {
  if(!env.SERVICE_TOKEN)throw new WritingConfigurationError("Set SERVICE_TOKEN in code/web/.dev.vars to connect the private writing repository.");
  if(!env.WRITING_REPO_OWNER || !env.WRITING_REPO_NAME)throw new WritingConfigurationError("Writing repository is not configured.");
  const forge=requirePublishingForge(createForge({kind:"github",owner:env.WRITING_REPO_OWNER,repo:env.WRITING_REPO_NAME,token:env.SERVICE_TOKEN}));
  let media:MediaStorage;
  const selfHosted=hostedMedia();
  const remoteFields=[env.R2_ACCOUNT_ID,env.R2_ACCESS_KEY_ID,env.R2_SECRET_ACCESS_KEY];
  if(remoteFields.some(Boolean) && !remoteFields.every(Boolean))throw new WritingConfigurationError("Provide all R2 credentials or leave all unset for local emulation.");
  if(selfHosted) { media=selfHosted; } else if(env.R2_ACCOUNT_ID && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.WRITING_R2_BUCKET){
    media=r2Media({accountId:env.R2_ACCOUNT_ID,bucket:env.WRITING_R2_BUCKET,accessKeyId:env.R2_ACCESS_KEY_ID,secretAccessKey:env.R2_SECRET_ACCESS_KEY});
  } else {
    if(!env.WRITING_MEDIA)throw new WritingConfigurationError("Writing media storage is not configured.");
    media=localR2Media(env.WRITING_MEDIA);
  }
  const service=createPublishingService({forge,author:{name:env.WRITING_AUTHOR_NAME ?? "Local writer",email:env.WRITING_AUTHOR_EMAIL ?? "writer@quiescent.invalid"},verifyMedia:async post=>{
    for(const ref of postImageReferences(post)){
      if(ref.postId!==post.id)throw new PublishingError("Images must belong to this post.","invalid");
      await media.verify(ref.postId,ref.assetId);
    }
  }});
  return {service,media};
}
