import type { WritingDocument } from "./content/document.ts";
import type { DocumentInput, Frontmatter } from "./document-codec.ts";
export interface DocumentRecord<T extends Frontmatter = Frontmatter> extends DocumentInput<T> {
  id: string;
  createdAt?: string;
  publishedAt?: string;
}
export interface StoredDocument<T extends Frontmatter = Frontmatter> extends DocumentRecord<T> {
  publicationSource?: string;
  deletedAt?: string;
}
export type DocumentState = "draft" | "published" | "unpublished-changes";
export interface DocumentDraft<T extends Frontmatter = Frontmatter> {
  document: DocumentRecord<T>;
  branch: string | null;
  headSha: string;
  state: DocumentState;
}
export interface DocumentSelection {
  id: string;
  branch: string;
  expectedHeadSha: string;
}
export type PostBody = WritingDocument;
export interface PostDocument extends Omit<PostMetadata, "tags" | "headerImage"> {
  id: string;
  tags?: PostMetadata["tags"];
  headerImage?: PostMetadata["headerImage"];
  body: PostBody;
  createdAt?: string;
  publishedAt?: string;
}
export interface PostDraft {
  post: PostDocument;
  branch: string | null;
  headSha: string;
  state: DocumentState;
}
export type DraftSelection = DocumentSelection;
export type PostMetadata = {
  title: string;
  description: string;
  slug: string | null;
  tags: string[];
  headerImage: string | null;
};

export interface DeleteSelection {
  id: string;
  expectedHeadSha: string;
  branch?: string | null;
}
export interface ApiError {
  error: string;
  fields?: Record<string, string>;
}
export type MutationResponse<T> = T & { cacheWarning?: string };
export interface UploadTicket {
  assetId: string;
  url: string;
  headers: Record<string, string>;
}
export interface ConfirmedUpload {
  src: string;
}
