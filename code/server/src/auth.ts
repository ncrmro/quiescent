// Decouples "who is editing" (AuthAdapter) from "what credential commits"
// (TokenSource). Two built-in modes:
//
// - Forge OAuth (original quiescent): the user logs in against the forge and
//   commits with their own token. AuthAdapter = the session cookie, TokenSource
//   = forgeSessionTokenSource.
// - Host auth + service token: the host app already authenticates users
//   (better-auth, anything that can produce a WikiUser from a Request) and a
//   single forge token (PAT / app token) authors commits attributed to the
//   editing user via git author override.
import type { CommitSignature } from "@quiescent/git";
import type { Env } from "./env.ts";
import { getSessionById, getValidAccessToken, type Session } from "./session.ts";

export interface WikiUser {
  /**
   * Stable id used to key drafts. For better-auth prefer the email — ids from
   * non-persistent adapters change across restarts.
   */
  id: string;
  name?: string;
  email?: string;
  /** Direct commit to the default branch vs propose-via-pull-request. */
  canPush: boolean;
}

export interface AuthAdapter {
  /** Resolve the current user from a request, or null when unauthenticated. */
  getUser(request: Request, env: Env): Promise<WikiUser | null>;
}

export interface CommitIdentity {
  token: string;
  /** Author override passed to commitFiles; also mirrored as a Co-authored-by trailer. */
  author?: CommitSignature;
}

export interface TokenSource {
  /** sessionId is present only in forge-OAuth mode (token refresh needs it). */
  getCommitIdentity(user: WikiUser, sessionId?: string): Promise<CommitIdentity>;
}

/**
 * The service token must never author an anonymous commit: without an email
 * on the user there is nothing to attribute, so the flush fails before any
 * forge call. Hosts surface this as "set an email on your account to save".
 */
export class MissingAuthorEmailError extends Error {
  constructor(userId: string) {
    super(`user ${userId} has no email to attribute the commit to`);
    this.name = "MissingAuthorEmailError";
  }
}

/** Single shared forge credential; commits attributed via author override. */
export function serviceTokenSource(token: string): TokenSource {
  return {
    async getCommitIdentity(user) {
      if (!user.email) throw new MissingAuthorEmailError(user.id);
      return { token, author: { name: user.name || user.email, email: user.email } };
    },
  };
}

/** Original behavior: the user's own forge OAuth token, refreshed as needed. */
export function forgeSessionTokenSource(env: Env, origin: string): TokenSource {
  return {
    async getCommitIdentity(_user, sessionId) {
      if (!sessionId) throw new Error("forge-OAuth mode requires a sessionId");
      const session = await getSessionById(env, sessionId);
      if (!session) throw new Error(`session ${sessionId} expired or missing`);
      const token = await getValidAccessToken(env, origin, sessionId, session);
      return { token };
    },
  };
}

/** Picks the token source from the environment: SERVICE_TOKEN wins. */
export function resolveTokenSource(env: Env, origin: string): TokenSource {
  return env.SERVICE_TOKEN
    ? serviceTokenSource(env.SERVICE_TOKEN)
    : forgeSessionTokenSource(env, origin);
}

/** Adapts a forge-OAuth Session to the WikiUser shape used by drafts/flush. */
export function wikiUserFromSession(session: Session): WikiUser {
  return {
    id: String(session.userId),
    name: session.login,
    canPush: session.canPush,
  };
}
