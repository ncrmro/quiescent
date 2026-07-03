import { ForgeError } from "./errors.ts";
import { resolveGiteaBaseUrl } from "./gitea.ts";
import type { ForgeKind } from "./types.ts";

export interface OAuthConfig {
  kind: ForgeKind;
  /** Required for gitea/forgejo; defaults for github/codeberg. */
  baseUrl?: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  fetch?: typeof fetch;
}

export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  /** Epoch milliseconds; undefined when the token does not expire. */
  expiresAt?: number;
}

function webBase(config: Pick<OAuthConfig, "kind" | "baseUrl">): string {
  if (config.kind === "github") return config.baseUrl?.replace(/\/$/, "") ?? "https://github.com";
  return resolveGiteaBaseUrl(config);
}

export function authorizeUrl(config: OAuthConfig, state: string): string {
  const url = new URL(`${webBase(config)}/login/oauth/authorize`);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("response_type", "code");
  return url.toString();
}

export async function exchangeCode(config: OAuthConfig, code: string): Promise<TokenSet> {
  return requestToken(config, {
    grant_type: "authorization_code",
    code,
    redirect_uri: config.redirectUri,
  });
}

export async function refreshToken(config: OAuthConfig, token: string): Promise<TokenSet> {
  return requestToken(config, {
    grant_type: "refresh_token",
    refresh_token: token,
  });
}

async function requestToken(
  config: OAuthConfig,
  params: Record<string, string>,
): Promise<TokenSet> {
  const fetchImpl = config.fetch ?? fetch;
  const url = `${webBase(config)}/login/oauth/access_token`;
  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "quiescent",
    },
    body: JSON.stringify({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      ...params,
    }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new ForgeError(`token request failed: ${response.status} ${body.slice(0, 300)}`, response.status, url);
  }
  const data = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };
  // GitHub returns 200 with an error field on bad requests.
  if (!data.access_token) {
    throw new ForgeError(
      `token request failed: ${data.error ?? "no access_token"} ${data.error_description ?? ""}`,
      400,
      url,
    );
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
  };
}
