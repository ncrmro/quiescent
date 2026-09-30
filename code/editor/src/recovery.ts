import { validateDocument } from "@quiescent/server/content";
import type { PostDocument } from "@quiescent/server/contracts";

type RecoveredPost = Pick<PostDocument, "title" | "description" | "body"> &
  Partial<Pick<PostDocument, "slug" | "tags" | "headerImage">>;
export interface RecoveryRecord {
  key: string;
  raw: string;
  updatedAt: number;
  post: RecoveredPost;
}
export type RecoveryStorage = Pick<Storage, "length" | "key" | "getItem" | "removeItem">;
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid recovery");
  return value as Record<string, unknown>;
}
function metadata(post: Record<string, unknown>): Partial<RecoveredPost> {
  const result: Partial<RecoveredPost> = {};
  if (typeof post.slug === "string" || post.slug === null) result.slug = post.slug;
  if (typeof post.headerImage === "string" || post.headerImage === null)
    result.headerImage = post.headerImage;
  if (Array.isArray(post.tags) && post.tags.every((v: unknown) => typeof v === "string"))
    result.tags = post.tags;
  return result;
}
function parseRecord(key: string, raw: string): RecoveryRecord {
  const value = object(JSON.parse(raw));
  const post = object(value.post);
  if (typeof post.title !== "string" || typeof post.description !== "string")
    throw new Error("Invalid recovery");
  return {
    key,
    raw,
    updatedAt:
      typeof value.updatedAt === "number" && Number.isFinite(value.updatedAt) ? value.updatedAt : 0,
    post: {
      ...metadata(post),
      title: post.title,
      description: post.description,
      body: validateDocument(post.body),
    },
  };
}
/** Failed parses stay in storage for manual recovery; old editing cycles are still offered. */
export function findRecoveryRecords(storage: RecoveryStorage, prefix: string): RecoveryRecord[] {
  const records: RecoveryRecord[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key?.startsWith(prefix)) continue;
    const raw = storage.getItem(key);
    if (!raw) continue;
    try {
      records.push(parseRecord(key, raw));
    } catch {
      /* Keep malformed records for manual recovery. */
    }
  }
  return records.sort((a, b) => b.updatedAt - a.updatedAt);
}
export function removeRecoveredRecord(
  storage: RecoveryStorage,
  record: Pick<RecoveryRecord, "key" | "raw">,
): void {
  if (storage.getItem(record.key) === record.raw) storage.removeItem(record.key);
}
