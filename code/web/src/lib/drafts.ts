import type { Env } from "./env.ts";

const DRAFT_PREFIX = "draft:";

export interface Draft {
  userId: number;
  /** Session that produced the draft; the cron flush uses its stored tokens. */
  sessionId: string;
  path: string;
  content: string;
  /** Blob sha the edit was based on; absent for new files. */
  baseSha?: string;
  updatedAt: number;
}

function draftKey(userId: number, path: string): string {
  return `${DRAFT_PREFIX}${userId}:${path}`;
}

export async function saveDraft(env: Env, draft: Draft): Promise<void> {
  await env.DRAFTS.put(draftKey(draft.userId, draft.path), JSON.stringify(draft));
}

export async function deleteDraft(env: Env, userId: number, path: string): Promise<void> {
  await env.DRAFTS.delete(draftKey(userId, path));
}

export async function getDraft(env: Env, userId: number, path: string): Promise<Draft | null> {
  const raw = await env.DRAFTS.get(draftKey(userId, path));
  return raw ? (JSON.parse(raw) as Draft) : null;
}

export async function listUserDrafts(env: Env, userId: number): Promise<Draft[]> {
  return listDrafts(env, `${DRAFT_PREFIX}${userId}:`);
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
