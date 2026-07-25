import type { ForgeConfig, ForgeKind, OAuthConfig } from "@quiescent/git";
import type { KeyValueStore } from "./kv.ts";

/**
 * Deployment-agnostic runtime configuration. On Cloudflare Workers this is
 * the worker env (KV bindings + vars); self-hosted deployments construct the
 * same shape with their own stores and configuration source.
 */
export interface Env {
  /** Required in forge-OAuth mode; unused when SERVICE_TOKEN is set. */
  SESSIONS?: KeyValueStore;
  DRAFTS: KeyValueStore;
  FORGE_KIND: ForgeKind;
  FORGE_BASE_URL?: string;
  REPO_OWNER: string;
  REPO_NAME: string;
  DEFAULT_BRANCH: string;
  /**
   * Shared forge credential (PAT / app token). When set, the host app's own
   * auth supplies the user and commits are attributed via author override —
   * the OAUTH and SESSION config below is not needed.
   */
  SERVICE_TOKEN?: string;
  OAUTH_CLIENT_ID?: string;
  OAUTH_CLIENT_SECRET?: string;
  /** Where the app mounts its OAuth callback route; defaults to /auth/callback. */
  OAUTH_CALLBACK_PATH?: string;
  SESSION_SECRET?: string;
  /** Injectable for tests and exotic runtimes. */
  fetch?: typeof fetch;
}

/** The forge-OAuth session store; throws when running in service-token mode. */
export function requireSessions(env: Env): KeyValueStore {
  if (!env.SESSIONS) {
    throw new Error("SESSIONS store is not configured (service-token mode has no forge sessions)");
  }
  return env.SESSIONS;
}

export function requireSessionSecret(env: Env): string {
  if (!env.SESSION_SECRET) throw new Error("SESSION_SECRET is not configured");
  return env.SESSION_SECRET;
}

export function forgeConfig(env: Env, token: string): ForgeConfig {
  return {
    kind: env.FORGE_KIND,
    baseUrl: env.FORGE_BASE_URL || undefined,
    owner: env.REPO_OWNER,
    repo: env.REPO_NAME,
    token,
    fetch: env.fetch,
  };
}

export function oauthConfig(env: Env, origin: string): OAuthConfig {
  if (!env.OAUTH_CLIENT_ID || !env.OAUTH_CLIENT_SECRET) {
    throw new Error("OAUTH_CLIENT_ID/OAUTH_CLIENT_SECRET are not configured");
  }
  return {
    kind: env.FORGE_KIND,
    baseUrl: env.FORGE_BASE_URL || undefined,
    clientId: env.OAUTH_CLIENT_ID,
    clientSecret: env.OAUTH_CLIENT_SECRET,
    redirectUri: `${origin}${env.OAUTH_CALLBACK_PATH ?? "/auth/callback"}`,
  };
}
