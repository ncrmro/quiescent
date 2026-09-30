import type { CommitSignature, LfsStorage, PublishingForge } from "@quiescent/git";
import { isAssetFilename } from "./content/assets.ts";
import { imageReferences, validateDocument } from "./content/document.ts";
import { fromMarkdown, toMarkdown } from "./content/markdown.ts";
import { createDocumentMedia } from "./document-assets.ts";
import { DocumentError } from "./document-error.ts";
import {
  createDocumentStore,
  type DocumentDraft,
  type DocumentRecord,
  type JSONSchema,
} from "./document-store.ts";
import type { MediaStorage } from "./media.ts";

export { DocumentError as PublishingError } from "./document-error.ts";

import type {
  DraftSelection,
  PostBody,
  PostDocument,
  PostDraft,
  PostMetadata,
} from "./contracts.ts";

export type {
  DraftSelection,
  PostBody,
  PostDocument,
  PostDraft,
  PostMetadata,
} from "./contracts.ts";
export const postSchema: JSONSchema = {
  type: "object",
  additionalProperties: false,
  required: ["title", "description", "slug", "tags", "headerImage"],
  properties: {
    title: { type: "string", title: "Title", maxLength: 300 },
    description: { type: "string", title: "Description", maxLength: 2000 },
    slug: {
      type: ["string", "null"],
      title: "Slug",
      description: "Use lowercase words separated by hyphens.",
      maxLength: 160,
      pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$",
    },
    tags: {
      type: "array",
      title: "Tags",
      maxItems: 30,
      uniqueItems: true,
      items: { type: "string", minLength: 1, maxLength: 80 },
    },
    headerImage: {
      type: ["string", "null"],
      title: "Header image",
      pattern:
        "^(?:[a-zA-Z0-9][a-zA-Z0-9_.-]*\\.(?:png|jpe?g|webp)|/media/[a-zA-Z0-9_-]+/[a-zA-Z0-9_-]+)$",
    },
  },
};
export interface PublishingOptions {
  media?: MediaStorage;
  lfs?: LfsStorage;
  forge: PublishingForge;
  author: CommitSignature;
  defaultBranch?: string;
  validateDocument?: (body: PostBody) => void | Promise<void>;
  verifyMedia?: (post: PostDocument) => void | Promise<void>;
}
const toPost = (document: DocumentRecord<PostMetadata>): PostDocument => ({
  id: document.id,
  ...document.frontmatter,
  body: fromMarkdown(document.body),
  ...(document.createdAt ? { createdAt: document.createdAt } : {}),
  ...(document.publishedAt ? { publishedAt: document.publishedAt } : {}),
});
const toDraft = (draft: DocumentDraft<PostMetadata>): PostDraft => ({
  post: toPost(draft.document),
  branch: draft.branch,
  headSha: draft.headSha,
  state: draft.state,
});
function metadata(post: PostDocument): PostMetadata {
  return {
    title: post.title,
    description: post.description,
    slug: post.slug,
    tags: post.tags ?? [],
    headerImage: post.headerImage ?? null,
  };
}
const generatedSlug = (title: string, id: string) =>
  `${
    title
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80) || "post"
  }-${id.slice(0, 8)}`;
async function verifyPostImages(post: PostDocument, media?: MediaStorage) {
  for (const ref of postImageReferences(post)) {
    if (ref.postId !== post.id)
      throw new DocumentError("Images must belong to this post.", "invalid");
    if (media && !isAssetFilename(ref.assetId)) await media.verify(ref.postId, ref.assetId);
  }
}
/** Posts are one schema and a rich-text adapter over the general Markdown document store. */
export function createPublishingService(options: PublishingOptions) {
  const assets =
    options.media && options.lfs
      ? createDocumentMedia<PostMetadata>({
          forge: options.forge,
          delivery: options.media,
          lfs: options.lfs,
          references: (document) =>
            postImageReferences(toPost(document))
              .filter((r) => isAssetFilename(r.assetId))
              .map((r) => r.assetId),
        })
      : {
          async prepare(document: DocumentRecord<PostMetadata>) {
            if (postImageReferences(toPost(document)).some((r) => isAssetFilename(r.assetId)))
              throw new DocumentError(
                "Configure media delivery and Git LFS before saving images.",
                "invalid",
              );
            return {};
          },
          async read() {
            return null;
          },
        };
  const store = createDocumentStore<PostMetadata>({
    ...options,
    collection: "posts",
    directoryTemplate: "{createdAt:YYYY-MM-DD}-{slug}",
    ...(assets ? { assets } : {}),
    schema: postSchema,
    legacy: {
      filename: "post.json",
      decode(source, id) {
        const post = JSON.parse(source) as PostDocument & {
          publicationSource?: string;
          deletedAt?: string;
        };
        if (post.id !== id) throw new DocumentError("Document identifier mismatch", "invalid");
        return {
          id,
          frontmatter: {
            ...metadata(post),
            slug: post.slug ?? (post.title.trim() ? generatedSlug(post.title, id) : null),
          },
          body: toMarkdown(post.body),
          ...(post.publishedAt ? { publishedAt: post.publishedAt } : {}),
          ...(post.publicationSource ? { publicationSource: post.publicationSource } : {}),
          ...(post.deletedAt ? { deletedAt: post.deletedAt } : {}),
        };
      },
    },
    async beforePublish(document) {
      const post = toPost(document);
      if (!post.title.trim())
        throw new DocumentError("Add a title before publishing.", "invalid", {
          title: "Add a title before publishing.",
        });
      if (!post.slug)
        throw new DocumentError("Add a slug before publishing.", "invalid", {
          slug: "Add a slug before publishing.",
        });
      if (
        (await store.listPublished()).some(
          (other) =>
            other.document.id !== document.id && other.document.frontmatter.slug === post.slug,
        )
      )
        throw new DocumentError("This slug is already published. Choose another.", "conflict", {
          slug: "This slug is already published.",
        });
      await options.validateDocument?.(post.body);
      await verifyPostImages(post, options.media);
      await options.verifyMedia?.(post);
    },
  });
  return {
    schema: postSchema,
    documents: store,
    async readMedia(id: string, name: string, branch?: string) {
      if (!isAssetFilename(name)) return options.media?.read(id, name) ?? null;
      const draft = branch ? await store.getDraft(id, branch) : await store.getPublished(id);
      if (!draft || !assets) return null;
      const context = await store.location(id, draft.headSha);
      return assets.read(id, name, { ...context, ref: draft.headSha });
    },
    async createPost() {
      return toDraft(
        await store.createDocument({
          frontmatter: { title: "", description: "", slug: null, tags: [], headerImage: null },
          body: "",
        }),
      );
    },
    async getDraft(id: string, branch?: string) {
      return toDraft(await store.getDraft(id, branch));
    },
    async saveDraft(input: DraftSelection & { post: PostDocument }) {
      if (input.id !== input.post.id)
        throw new DocumentError("Document identifier mismatch", "invalid");
      await options.validateDocument?.(input.post.body);
      const fields = metadata(input.post);
      if (
        (fields.slug === null || fields.slug === input.id) &&
        typeof fields.title === "string" &&
        fields.title.trim()
      )
        fields.slug = generatedSlug(fields.title, input.id);
      fields.slug ??= input.id;
      return toDraft(
        await store.saveDraft({
          ...input,
          document: { frontmatter: fields, body: toMarkdown(validateDocument(input.post.body)) },
        }),
      );
    },
    async publish(input: DraftSelection) {
      const { document, ...result } = await store.publish(input);
      return { ...result, post: toPost(document) };
    },
    async deletePost(input: { id: string; branch?: string | null; expectedHeadSha: string }) {
      const { document, ...result } = await store.deleteDocument(input);
      return { ...result, post: toPost(document) };
    },
    async getPublished(id: string) {
      const value = await store.getPublished(id);
      return value ? toDraft(value) : null;
    },
    async listPublished() {
      return (await store.listPublished()).map(toDraft);
    },
    async listPosts() {
      return (await store.listDocuments()).map(toDraft);
    },
    async findPostForEditing(slug: string): Promise<PostDraft | null> {
      if (/^[0-9a-f-]{36}$/.test(slug)) {
        try {
          return toDraft(await store.getDraft(slug));
        } catch (error) {
          if (error instanceof DocumentError && error.code === "not_found") return null;
          throw error;
        }
      }
      const published = (await store.listPublished()).find(
        (p) => p.document.frontmatter.slug === slug,
      );
      if (published) return toDraft(published);
      return (await store.listDocuments()).map(toDraft).find((p) => p.post.slug === slug) ?? null;
    },
  };
}

export function postImageReferences(post: PostDocument) {
  const references = imageReferences(post.body);
  if (post.headerImage) {
    const match = /^\/media\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_-]+)$/.exec(post.headerImage);
    if (!match && !isAssetFilename(post.headerImage))
      throw new DocumentError("Invalid header image", "invalid", {
        headerImage: "Choose a valid image.",
      });
    references.push({ postId: match?.[1] ?? post.id, assetId: match?.[2] ?? post.headerImage });
  }
  return references.map((ref) => ({ ...ref, postId: ref.postId || post.id }));
}
