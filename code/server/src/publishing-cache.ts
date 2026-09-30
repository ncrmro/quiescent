import type { createPublishingService, PostDraft } from "./publishing";

export type PublishingService = ReturnType<typeof createPublishingService>;
export type CacheScope = "published" | "author";
export interface PublishingSnapshot {
  posts: PostDraft[];
  expiresAt: number;
  generation?: number;
}
/** A rebuild claims a generation. An older rebuild cannot replace a newer one. */
export interface PublishingSnapshotStore {
  read(scope: CacheScope): Promise<PublishingSnapshot | null>;
  begin(scope: CacheScope): Promise<number>;
  commit(scope: CacheScope, generation: number, snapshot: PublishingSnapshot): Promise<boolean>;
}
export const PUBLISHING_CACHE_TTL = 24 * 60 * 60 * 1000;

/** Shared, write-through indexes. Git remains authoritative for mutations. */
export function cachedPublishingService(service: PublishingService, store: PublishingSnapshotStore, isAncestor: (older:string,newer:string)=>Promise<boolean>) {
  async function refresh(scope: CacheScope): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const generation = await store.begin(scope);
      const posts = await (scope === "published" ? service.listPublished() : service.listPosts());
      if (await store.commit(scope, generation, {posts, expiresAt: Date.now() + PUBLISHING_CACHE_TTL})) return;
    }
    throw new Error("Cache refresh was superseded; retry the refresh.");
  }
  async function update(scope: CacheScope, post: PostDraft): Promise<void> {
    for (let attempt=0; attempt<8; attempt++) {
      const snapshot=await store.read(scope);
      if (!snapshot) { await refresh(scope); continue; }
      const previous=snapshot.posts.find(p=>p.post.id===post.post.id);
      if (previous?.headSha === post.headSha && previous.branch === post.branch) return;
      // A delayed save must not replace a later save or resurrect a published draft.
      if (previous && await isAncestor(post.headSha, previous.headSha)) return;
      // Publishing an older revision must not erase a newer private edit.
      if (scope === "author" && post.state === "published" && previous?.branch
        && !await isAncestor(previous.headSha, post.headSha)) return;
      const posts=[...snapshot.posts.filter(p=>p.post.id!==post.post.id),post];
      if (await store.commit(scope,snapshot.generation!,{posts,expiresAt:Date.now()+PUBLISHING_CACHE_TTL})) return;
    }
    throw new Error("Cache changed repeatedly while updating this post; retry the refresh.");
  }
  async function cached(scope: CacheScope): Promise<PostDraft[]> {
    const snapshot = await store.read(scope);
    // Cache population belongs to deployment, writes, and scheduled maintenance.
    // Keep the last good snapshot available if background maintenance is delayed.
    if (!snapshot) throw new Error("Publishing cache has not been initialized.");
    return snapshot.posts;
  }
  async function warmCache() {
    await Promise.all([refresh("published"), refresh("author")]);
  }
  return {
    ...service,
    warmCache,
    async listPublished() { return cached("published"); },
    async getPublished(id: string) { return (await cached("published")).find(p => p.post.id === id) ?? null; },
    async listPosts() { return cached("author"); },
    async findPostForEditing(slug: string) {
      return (await cached("author")).find(({post}) => (post.slug ?? post.id) === slug) ?? null;
    },
    async createPost() {
      const result = await service.createPost();
      await update("author", result);
      return result;
    },
    async getDraft(id: string, branch?: string) {
      const result = await service.getDraft(id, branch);
      const previous = (await store.read("author"))?.posts.find(p => p.post.id === id);
      // Opening a published post may create its revision branch.
      if (previous?.headSha !== result.headSha || previous.branch !== result.branch) await update("author", result);
      return result;
    },
    async saveDraft(input: Parameters<PublishingService["saveDraft"]>[0]) {
      const result = await service.saveDraft(input);
      await update("author", result);
      return result;
    },
    async publish(input: Parameters<PublishingService["publish"]>[0]) {
      const result = await service.publish(input);
      const published:PostDraft={post:result.post,branch:null,headSha:result.publishedSha,state:"published"};
      await Promise.all([update("published",published),update("author",published)]);
      return result;
    },
  };
}
