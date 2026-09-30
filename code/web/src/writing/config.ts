import type { MediaBucket } from "@quiescent/server";
/** The same application configuration on Node and Workers; runtime adapters supply bindings. */
export interface WritingEnv {
  SERVICE_TOKEN?: string;
  WRITING_REPO_OWNER?: string;
  WRITING_REPO_NAME?: string;
  WRITING_AUTHOR_NAME?: string;
  WRITING_AUTHOR_EMAIL?: string;
  WRITING_MEDIA?: MediaBucket;
  WRITING_R2_BUCKET?: string;
  R2_ACCOUNT_ID?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
}
