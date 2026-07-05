import type { KVNamespace } from "@cloudflare/workers-types";
import type { ForgeConfig, ForgeKind, OAuthConfig } from "@ncrmro/quiescent-git";

export interface Env {
  SESSIONS: KVNamespace;
  DRAFTS: KVNamespace;
  FORGE_KIND: ForgeKind;
  FORGE_BASE_URL?: string;
  REPO_OWNER: string;
  REPO_NAME: string;
  DEFAULT_BRANCH: string;
  OAUTH_CLIENT_ID: string;
  OAUTH_CLIENT_SECRET: string;
  SESSION_SECRET: string;
}

export function forgeConfig(env: Env, token: string): ForgeConfig {
  return {
    kind: env.FORGE_KIND,
    baseUrl: env.FORGE_BASE_URL || undefined,
    owner: env.REPO_OWNER,
    repo: env.REPO_NAME,
    token,
  };
}

export function oauthConfig(env: Env, origin: string): OAuthConfig {
  return {
    kind: env.FORGE_KIND,
    baseUrl: env.FORGE_BASE_URL || undefined,
    clientId: env.OAUTH_CLIENT_ID,
    clientSecret: env.OAUTH_CLIENT_SECRET,
    redirectUri: `${origin}/auth/callback`,
  };
}
