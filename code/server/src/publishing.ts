import type { CommitSignature, PublishingForge } from "@quiescent/git";

import { validateDocument, type WritingDocument } from "@quiescent/editor/document";

export type PostBody = WritingDocument;
export interface PostDocument {
  id: string;
  title: string;
  description: string;
  slug: string | null;
  body: PostBody;
  publishedAt?: string;
}
interface StoredPost extends PostDocument { publicationSource?: string }
export interface PostDraft {
  post: PostDocument;
  branch: string | null;
  headSha: string;
  state: "draft" | "published" | "unpublished-changes";
}
export interface DraftSelection { id: string; branch: string; expectedHeadSha: string }
export class PublishingError extends Error {
  constructor(message: string, public readonly code: "invalid" | "conflict" | "not_found") {
    super(message);
    this.name = "PublishingError";
  }
}
export interface PublishingOptions {
  forge: PublishingForge;
  author: CommitSignature;
  defaultBranch?: string;
  validateDocument?: (body: PostBody) => void | Promise<void>;
  verifyMedia?: (post: PostDocument) => void | Promise<void>;
}
const prefix = "quiescent/posts/";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function path(id: string) {
  if (!uuid.test(id)) throw new PublishingError("Invalid post identifier", "invalid");
  return `posts/${id}/post.json`;
}
function checkBranch(id: string, branch: string) {
  path(id);
  if (!branch.startsWith(`${prefix}${id}/`) || !uuid.test(branch.slice(`${prefix}${id}/`.length))) {
    throw new PublishingError("Invalid draft", "invalid");
  }
}
function publicPost(post: StoredPost): PostDocument {
  const { publicationSource: _, ...document } = post;
  return document;
}

/** Stateless post lifecycle: GitHub is the only authority for saved drafts and publications. */
export function createPublishingService(options: PublishingOptions) {
  const { forge, author } = options;
  const main = options.defaultBranch ?? "main";
  async function read(id: string, ref: string): Promise<StoredPost | null> {
    const file = await forge.getFile(path(id), ref);
    if (!file) return null;
    const post = JSON.parse(file.content) as StoredPost;
    if (post.id !== id) throw new PublishingError("Post identifier mismatch", "invalid");
    return post;
  }
  async function checked(post: PostDocument): Promise<PostDocument> {
    path(post.id);
    if (typeof post.title !== "string" || post.title.length > 300 || typeof post.description !== "string" || post.description.length > 2000 || post.body?.type !== "doc") {
      throw new PublishingError("Invalid post document", "invalid");
    }
    await options.validateDocument?.(post.body);
    // Only server-maintained fields may control publication and routing.
    return { id: post.id, title: post.title, description: post.description, slug: null, body: validateDocument(post.body) };
  }
  async function commit(branch: string, expectedHeadSha: string, post: StoredPost, message: string) {
    return forge.commitFiles({ branch, expectedHeadSha, author, message, files: [{ path: path(post.id), content: JSON.stringify(post, null, 2) + "\n" }] });
  }
  async function getPublished(id: string): Promise<PostDraft | null> {
    const headSha = await forge.getBranchSha(main);
    const post = await read(id, headSha);
    return post?.publishedAt ? { post: publicPost(post), branch: null, headSha, state: "published" } : null;
  }
  async function listPublished(): Promise<PostDraft[]> {
    const headSha = await forge.getBranchSha(main);
    const entries = await forge.listDir("posts", headSha).catch((error: unknown) => {
      if (typeof error === "object" && error !== null && "status" in error && error.status === 404) return [];
      throw error;
    });
    const posts = await Promise.all(entries.filter(e => e.type === "dir" && uuid.test(e.name)).map(async e => {
      const post = await read(e.name, headSha);
      return post?.publishedAt ? { post: publicPost(post), branch: null, headSha, state: "published" as const } : null;
    }));
    return posts.filter((p): p is PostDraft & {state:"published";branch:null} => p !== null);
  }
  async function activeDrafts(id?: string): Promise<PostDraft[]> {
    const mainSha = await forge.getBranchSha(main);
    const branches = await forge.listBranches(id ? `${prefix}${id}/` : prefix);
    const result: PostDraft[] = [];
    for (const { name, sha } of branches) {
      const postId = name.slice(prefix.length).split("/")[0]!;
      try { checkBranch(postId, name); } catch { continue; }
      if (await forge.isAncestor(sha, mainSha)) continue;
      const post = await read(postId, sha);
      if (post) result.push({ post: publicPost(post), branch: name, headSha: sha, state: post.publishedAt ? "unpublished-changes" : "draft" });
    }
    return result;
  }
  async function start(post: PostDocument): Promise<PostDraft> {
    const sha = await forge.getBranchSha(main);
    const branch = `${prefix}${post.id}/${crypto.randomUUID()}`;
    await forge.createBranch(branch, sha);
    const result = await commit(branch, sha, post, "Save writing draft");
    return { post, branch, headSha: result.sha, state: post.publishedAt ? "unpublished-changes" : "draft" };
  }
  async function startPublished(published: PostDraft): Promise<PostDraft> {
    // One deterministic branch per published document revision, independent of unrelated
    // main-branch commits. GitHub's create-ref and commit CAS arbitrate concurrent tabs.
    const file = await forge.getFile(path(published.post.id), published.headSha);
    if (!file) throw new PublishingError("Post not found", "not_found");
    const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(file.content)))].map(b => b.toString(16).padStart(2, "0")).join("");
    const cycle = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
    const branch = `${prefix}${published.post.id}/${cycle}`;
    try {
      await forge.createBranch(branch, published.headSha);
    } catch (error) {
      // Also covers a successful create whose response was lost. Never reset a ref.
      try { await forge.getBranchSha(branch); } catch { throw error; }
    }
    const head = await forge.getBranchSha(branch);
    const current = await forge.getFile(path(published.post.id), head);
    if (current?.content === file.content) {
      try {
        await commit(branch, head, published.post, "Save writing draft");
      } catch (error) {
        // A racing initializer or writer won. Load its version instead of overwriting it.
        if (await forge.getBranchSha(branch) === head) throw error;
      }
    } else if (await forge.isAncestor(head, await forge.getBranchSha(main))) {
      // This exact cycle finished while the caller was opening it; resolve the new cycle.
      return getDraft(published.post.id);
    }
    return getDraft(published.post.id, branch);
  }
  async function createPost(): Promise<PostDraft> {
    return start({ id: crypto.randomUUID(), title: "", description: "", slug: null, body: { type: "doc", content: [{ type: "paragraph" }] } });
  }
  async function getDraft(id: string, branch?: string): Promise<PostDraft> {
    path(id);
    if (branch) {
      checkBranch(id, branch);
      const headSha = await forge.getBranchSha(branch);
      const post = await read(id, headSha);
      if (!post) throw new PublishingError("Draft not found", "not_found");
      return { post: publicPost(post), branch, headSha, state: post.publishedAt ? "unpublished-changes" : "draft" };
    }
    const drafts = await activeDrafts(id);
    if (drafts[0]) return drafts[0];
    const published = await getPublished(id);
    if (!published) throw new PublishingError("Post not found", "not_found");
    return startPublished(published);
  }
  async function saveDraft(input: DraftSelection & { post: PostDocument }): Promise<PostDraft> {
    checkBranch(input.id, input.branch);
    if (input.id !== input.post.id) throw new PublishingError("Post identifier mismatch", "invalid");
    const head = await forge.getBranchSha(input.branch);
    if (head !== input.expectedHeadSha) throw new PublishingError("This draft has newer changes. Your writing has been preserved.", "conflict");
    const previous = await read(input.id, head);
    if (!previous) throw new PublishingError("Draft not found", "not_found");
    if (await forge.isAncestor(head, await forge.getBranchSha(main))) {
      throw new PublishingError("This draft was published. Reopen the post to continue editing.", "conflict");
    }
    const post = { ...await checked(input.post), slug: previous.slug, ...(previous.publishedAt ? { publishedAt: previous.publishedAt } : {}) };
    const result = await commit(input.branch, head, post, "Save writing draft");
    return { post, branch: input.branch, headSha: result.sha, state: post.publishedAt ? "unpublished-changes" : "draft" };
  }
  async function publish(input: DraftSelection) {
    checkBranch(input.id, input.branch);
    let head = await forge.getBranchSha(input.branch);
    let post = await read(input.id, head);
    if (!post) throw new PublishingError("Draft not found", "not_found");
    const mainSha = await forge.getBranchSha(main);
    // A repeated request after a lost response must not re-publish or modify newer edits.
    const published = await read(input.id, mainSha);
    const requestedWasPrepared = published?.publicationSource && await forge.isAncestor(input.expectedHeadSha, mainSha)
      && (await read(input.id, input.expectedHeadSha))?.publicationSource === published.publicationSource;
    if (published && (published.publicationSource === input.expectedHeadSha || requestedWasPrepared)) {
      return { post: publicPost(published), headSha: head, publishedSha: mainSha, state: "published" as const };
    }
    if (head !== input.expectedHeadSha && post.publicationSource !== input.expectedHeadSha) {
      throw new PublishingError("This draft has newer changes. Review them before publishing.", "conflict");
    }
    const comparison = await forge.compareCommits(mainSha, head);
    if (!comparison.files.length || comparison.files.some(f => f.filename !== path(input.id) || (f.previousFilename && f.previousFilename !== path(input.id)))) {
      throw new PublishingError("The draft contains unexpected changes and cannot be published.", "invalid");
    }
    await checked(post);
    if (!post.title.trim()) throw new PublishingError("Add a title before publishing.", "invalid");
    await options.verifyMedia?.(publicPost(post));
    if (!post.publicationSource) {
      const slugBase = post.title.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "post";
      post = { ...post, slug: post.slug ?? `${slugBase}-${input.id.slice(0, 8)}`, publishedAt: post.publishedAt ?? new Date().toISOString(), publicationSource: input.expectedHeadSha };
      head = (await commit(input.branch, head, post, "Prepare post publication")).sha;
    }
    const publicationSource = post.publicationSource;
    const result = await forge.mergeBranch(main, head);
    const visible = await read(input.id, result.sha);
    if (!visible || visible.publicationSource !== publicationSource) throw new PublishingError("Publication could not be confirmed. Retry safely.", "conflict");
    return { post: publicPost(visible), headSha: head, publishedSha: result.sha, state: "published" as const };
  }
  async function listPosts(): Promise<PostDraft[]> {
    const drafts = await activeDrafts();
    const ids = new Set(drafts.map(d => d.post.id));
    return [...drafts, ...(await listPublished()).filter(p => !ids.has(p.post.id))];
  }
  return { createPost, getDraft, saveDraft, publish, getPublished, listPublished, listPosts };
}
