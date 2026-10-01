import { hostedMedia } from "quiescent:runtime";
import { createForge, createLfsClient, requirePublishingForge } from "@quiescent/git";
import {
  createDocumentService,
  DocumentError,
  localR2Media,
  type MediaStorage,
  r2Media,
  WritingConfigurationError,
} from "@quiescent/server";
import { markdownImages } from "@quiescent/server/content";
import { type Collection, collectionSchema, type ExampleMetadata } from "./collections";
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
export function writingApp(env: WritingEnv, collection: Collection = "posts") {
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
  const delivery = configuredMedia(env);
  const media: MediaStorage = {
    ...delivery,
    async prepare(id, type, size) {
      const ticket = await delivery.prepare(id, type, size);
      if (ticket.url.startsWith("/"))
        ticket.url = `/api/documents/${collection}/${id}/uploads/${ticket.assetId}`;
      return ticket;
    },
  };
  const service = createDocumentService<ExampleMetadata>({
    collection,
    schema: collectionSchema(collection),
    filename: (document) =>
      collection === "posts"
        ? `${document.createdAt}-${document.frontmatter.slug}`
        : document.frontmatter.slug,
    references: (document) => [
      ...markdownImages(document.body),
      ...(document.frontmatter.headerImage ? [document.frontmatter.headerImage] : []),
    ],
    async beforePublish(document) {
      if (!document.frontmatter.title.trim())
        throw new DocumentError("Add a title before publishing", "invalid");
      if (
        (await service.listPublished()).some(
          (other) =>
            other.document.id !== document.id &&
            other.document.frontmatter.slug === document.frontmatter.slug,
        )
      )
        throw new DocumentError("This slug is already published", "conflict");
    },
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
  });
  return { media, service };
}
