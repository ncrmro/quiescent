import type { WikiUser } from "./auth.ts";
import type { Env } from "./env.ts";

const DRAFT_PREFIX = "draft:";

export interface Draft {
  /** Snapshot of the editor; the flush uses it for attribution and mode. */
  user: WikiUser;
  /** Session that produced the draft; required only in forge-OAuth mode. */
  sessionId?: string;
  path: string;
  content: string;
  /** Blob sha the edit was based on; absent for new files. */
  baseSha?: string;
  updatedAt: number;
}

function draftKey(userId: string, path: string): string {
  return `${DRAFT_PREFIX}${encodeURIComponent(userId)}:${path}`;
}

export async function saveDraft(env: Env, draft: Draft): Promise<void> {
  await env.DRAFTS.put(draftKey(draft.user.id, draft.path), JSON.stringify(draft));
}

export async function deleteDraft(env: Env, userId: string, path: string): Promise<void> {
  await env.DRAFTS.delete(draftKey(userId, path));
}

export async function getDraft(env: Env, userId: string, path: string): Promise<Draft | null> {
  const raw = await env.DRAFTS.get(draftKey(userId, path));
  return raw ? (JSON.parse(raw) as Draft) : null;
}

export async function listUserDrafts(env: Env, userId: string): Promise<Draft[]> {
  return listDrafts(env, `${DRAFT_PREFIX}${encodeURIComponent(userId)}:`);
}

export async function listAllDrafts(env: Env): Promise<Draft[]> {
  return listDrafts(env, DRAFT_PREFIX);
}

async function listDrafts(env: Env, prefix: string): Promise<Draft[]> {
  const drafts: Draft[] = [];
  let cursor: string | undefined;
  do {
    const page = await env.DRAFTS.list({ prefix, cursor });
    for (const key of page.keys) {
      const raw = await env.DRAFTS.get(key.name);
      if (raw) drafts.push(JSON.parse(raw) as Draft);
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return drafts;
}
