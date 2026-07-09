import type { ForgeConfig, ForgeKind, OAuthConfig } from "@quiescent/git";
import type { KeyValueStore } from "./kv.ts";

/**
 * Deployment-agnostic runtime configuration. On Cloudflare Workers this is
 * the worker env (KV bindings + vars); self-hosted deployments construct the
 * same shape with their own stores and configuration source.
 */
export interface Env {
  SESSIONS: KeyValueStore;
  DRAFTS: KeyValueStore;
  FORGE_KIND: ForgeKind;
  FORGE_BASE_URL?: string;
  REPO_OWNER: string;
  REPO_NAME: string;
  DEFAULT_BRANCH: string;
  OAUTH_CLIENT_ID: string;
  OAUTH_CLIENT_SECRET: string;
  /** Where the app mounts its OAuth callback route; defaults to /auth/callback. */
  OAUTH_CALLBACK_PATH?: string;
  /**
   * "pull-request" routes every flush through a pull request, even for users
   * with push access; unset/"auto" keeps notes mode (direct commit) for them.
   */
  FLUSH_MODE?: "auto" | "pull-request";
  SESSION_SECRET: string;
  /** Injectable for tests. */
  fetch?: typeof fetch;
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
  return {
    kind: env.FORGE_KIND,
    baseUrl: env.FORGE_BASE_URL || undefined,
    clientId: env.OAUTH_CLIENT_ID,
    clientSecret: env.OAUTH_CLIENT_SECRET,
    redirectUri: `${origin}${env.OAUTH_CALLBACK_PATH ?? "/auth/callback"}`,
  };
}
