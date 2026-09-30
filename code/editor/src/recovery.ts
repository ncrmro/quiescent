import { validateDocument, type WritingDocument } from "./document.ts";

export interface RecoveryRecord {
  key: string;
  raw: string;
  updatedAt: number;
  post: { title: string; description: string; slug?:string|null; tags?:string[]; headerImage?:string|null; body: WritingDocument };
}
export type RecoveryStorage = Pick<
  Storage,
  "length" | "key" | "getItem" | "removeItem"
>;
/** Includes previous editing cycles and browser sessions; never mutates records. */
export function findRecoveryRecords(
  storage: RecoveryStorage,
  prefix: string,
): RecoveryRecord[] {
  const records: RecoveryRecord[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key?.startsWith(prefix)) continue;
    const raw = storage.getItem(key);
    if (!raw) continue;
    try {
      const value = JSON.parse(raw);
      if (
        typeof value.post?.title !== "string" ||
        typeof value.post.description !== "string"
      )
        continue;
      records.push({
        key,
        raw,
        updatedAt: Number.isFinite(value.updatedAt) ? value.updatedAt : 0,
        post: {
          title: value.post.title,
          description: value.post.description,
          ...(typeof value.post.slug==='string' || value.post.slug===null ? {slug:value.post.slug}:{}),
          ...(Array.isArray(value.post.tags) && value.post.tags.every((v:unknown)=>typeof v==='string') ? {tags:value.post.tags}:{}),
          ...(typeof value.post.headerImage==='string' || value.post.headerImage===null ? {headerImage:value.post.headerImage}:{}),
          body: validateDocument(value.post.body),
        },
      });
    } catch {
      /* Invalid records remain available for manual recovery. */
    }
  }
  return records.sort((a, b) => b.updatedAt - a.updatedAt);
}
/** A different tab may have updated this record since it was selected. */
export function removeRecoveredRecord(
  storage: RecoveryStorage,
  record: Pick<RecoveryRecord, "key" | "raw">,
): void {
  if (storage.getItem(record.key) === record.raw)
    storage.removeItem(record.key);
}
