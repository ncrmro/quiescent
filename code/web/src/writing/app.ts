import { hostedMedia } from "quiescent:runtime";
import { createForge, createLfsClient, requirePublishingForge } from "@quiescent/git";
import {
  createPublishingService,
  localR2Media,
  type MediaStorage,
  r2Media,
  WritingConfigurationError,
} from "@quiescent/server";
import type { WritingEnv } from "./config";

export { writingAuthor } from "./auth";
export type { WritingEnv } from "./config";

function configuredMedia(env: WritingEnv): MediaStorage {
  const credentials = [env.R2_ACCOUNT_ID, env.R2_ACCESS_KEY_ID, env.R2_SECRET_ACCESS_KEY];
  if (credentials.some(Boolean)) {
    if (
      !env.R2_ACCOUNT_ID ||
      !env.R2_ACCESS_KEY_ID ||
      !env.R2_SECRET_ACCESS_KEY ||
      !env.WRITING_R2_BUCKET
    )
      throw new WritingConfigurationError(
        "Provide the R2 account, bucket, access key, and secret together.",
      );
    return r2Media({
      accountId: env.R2_ACCOUNT_ID,
      bucket: env.WRITING_R2_BUCKET,
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    });
  }
  const local = hostedMedia();
  if (local) return local;
  if (env.WRITING_MEDIA) return localR2Media(env.WRITING_MEDIA);
  throw new WritingConfigurationError("Writing media storage is not configured.");
}
export function writingApp(env: WritingEnv) {
  if (!env.SERVICE_TOKEN)
    throw new WritingConfigurationError("Set SERVICE_TOKEN to connect the writing repository.");
  if (!env.WRITING_REPO_OWNER || !env.WRITING_REPO_NAME)
    throw new WritingConfigurationError("Writing repository is not configured.");
  const forge = requirePublishingForge(
    createForge({
      kind: "github",
      owner: env.WRITING_REPO_OWNER,
      repo: env.WRITING_REPO_NAME,
      token: env.SERVICE_TOKEN,
    }),
  );
  const media = configuredMedia(env);
  return {
    media,
    service: createPublishingService({
      forge,
      media,
      lfs: createLfsClient({
        endpoint: `https://github.com/${env.WRITING_REPO_OWNER}/${env.WRITING_REPO_NAME}.git/info/lfs`,
        authorization: `Basic ${btoa(`${env.WRITING_REPO_OWNER}:${env.SERVICE_TOKEN}`)}`,
      }),
      author: {
        name: env.WRITING_AUTHOR_NAME ?? "Example writer",
        email: env.WRITING_AUTHOR_EMAIL ?? "writer@example.invalid",
      },
    }),
  };
}
