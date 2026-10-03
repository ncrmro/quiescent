import { hostedDocumentCache, hostedMedia, scheduleCacheRefresh } from "quiescent:runtime";
import { createForge, createLfsClient, requirePublishingForge } from "@quiescent/git";
import {
  configuredCollection,
  createDocumentService,
  type DocumentDraft,
  DocumentError,
  defineDocumentConfig,
  localR2Media,
  type MediaStorage,
  r2Media,
  WritingConfigurationError,
} from "@quiescent/server";
import { markdownImages } from "@quiescent/server/content";
import configuration from "../../quiescent.config.json" with { type: "json" };
import type { Collection, ExampleMetadata } from "./collections";
import type { WritingEnv } from "./config";

const documentConfig = defineDocumentConfig(configuration);

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
export function writingApp(
  env: WritingEnv,
  collection: Collection = "posts",
  onPublishedChange?: (
    previous: DocumentDraft<ExampleMetadata>[],
    next: DocumentDraft<ExampleMetadata>[],
    retry?: boolean,
  ) => Promise<void>,
) {
  if (!env.SERVICE_TOKEN)
    throw new WritingConfigurationError("Set SERVICE_TOKEN to connect the writing repository.");
  const owner = env.WRITING_REPO_OWNER ?? documentConfig.repository.owner;
  const repo = env.WRITING_REPO_NAME ?? documentConfig.repository.name;
  const forge = requirePublishingForge(
    createForge({
      kind: documentConfig.repository.provider,
      owner,
      repo,
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
    ...configuredCollection<ExampleMetadata>(documentConfig, collection),
    cache: {
      storage: hostedDocumentCache(),
      key: JSON.stringify([
        documentConfig.repository.provider,
        owner,
        repo,
        documentConfig.repository.publishedBranch ?? "main",
        collection,
        documentConfig.collections[collection],
      ]),
      ttlMs: 60 * 60 * 1000,
      waitUntil: scheduleCacheRefresh,
      ...(onPublishedChange ? { onPublishedChange } : {}),
    },
    references: (document) => [
      ...markdownImages(document.body),
      ...(document.frontmatter.headerImage ? [document.frontmatter.headerImage] : []),
    ],
    async beforePublish(document) {
      if (!document.frontmatter.title.trim())
        throw new DocumentError("Add a title before publishing", "invalid");
      if (
        (await service.listPublishedFromGit()).some(
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
      endpoint: `https://github.com/${owner}/${repo}.git/info/lfs`,
      authorization: `Basic ${btoa(`${owner}:${env.SERVICE_TOKEN}`)}`,
    }),
    author: {
      name: env.WRITING_AUTHOR_NAME ?? "Example writer",
      email: env.WRITING_AUTHOR_EMAIL ?? "writer@example.invalid",
    },
  });
  return { media, service };
}
