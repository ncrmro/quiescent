import { refreshToken, type TokenSet } from "@ncrmro/quiescent-git";
import { oauthConfig, type Env } from "./env.ts";

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
export const SESSION_COOKIE = "qs_session";

export interface Session {
  userId: number;
  login: string;
  /** Captured at login; drives notes mode (direct commit) vs contributor mode (PR). */
  canPush: boolean;
  tokens: TokenSet;
}

function sessionKey(id: string): string {
  return `session:${id}`;
}

async function hmac(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function createSession(env: Env, session: Session): Promise<string> {
  const id = crypto.randomUUID();
  await env.SESSIONS.put(sessionKey(id), JSON.stringify(session), {
    expirationTtl: SESSION_TTL_SECONDS,
  });
  return id;
}

export async function saveSession(env: Env, id: string, session: Session): Promise<void> {
  await env.SESSIONS.put(sessionKey(id), JSON.stringify(session), {
    expirationTtl: SESSION_TTL_SECONDS,
  });
}

export async function getSessionById(env: Env, id: string): Promise<Session | null> {
  const raw = await env.SESSIONS.get(sessionKey(id));
  return raw ? (JSON.parse(raw) as Session) : null;
}

export async function deleteSession(env: Env, id: string): Promise<void> {
  await env.SESSIONS.delete(sessionKey(id));
}

export async function sessionCookieValue(env: Env, id: string): Promise<string> {
  return `${id}.${await hmac(env.SESSION_SECRET, id)}`;
}

/** Verifies the signed cookie value and returns the session id, or null. */
export async function verifySessionCookie(env: Env, value: string): Promise<string | null> {
  const dot = value.lastIndexOf(".");
  if (dot === -1) return null;
  const id = value.slice(0, dot);
  const signature = value.slice(dot + 1);
  const expected = await hmac(env.SESSION_SECRET, id);
  if (signature.length !== expected.length) return null;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) {
    mismatch |= signature.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return mismatch === 0 ? id : null;
}

export function readCookie(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

/**
 * Returns a usable access token, refreshing (and persisting) it when it is
 * within a minute of expiry. Throws if the refresh fails — the caller should
 * treat the session as logged out.
 */
export async function getValidAccessToken(
  env: Env,
  origin: string,
  sessionId: string,
  session: Session,
): Promise<string> {
  const { tokens } = session;
  if (!tokens.expiresAt || tokens.expiresAt > Date.now() + 60_000) {
    return tokens.accessToken;
  }
  if (!tokens.refreshToken) {
    throw new Error("access token expired and no refresh token available");
  }
  const refreshed = await refreshToken(oauthConfig(env, origin), tokens.refreshToken);
  session.tokens = refreshed;
  await saveSession(env, sessionId, session);
  return refreshed.accessToken;
}
