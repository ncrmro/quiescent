import { describe, expect, test } from "bun:test";
import { authorizeUrl, exchangeCode, refreshToken, type OAuthConfig } from "../src/oauth.ts";
import { createMockFetch } from "./mock-fetch.ts";

const base: Omit<OAuthConfig, "kind"> = {
  clientId: "cid",
  clientSecret: "secret",
  redirectUri: "https://quiescent.example/auth/callback",
};

describe("authorizeUrl", () => {
  test("github", () => {
    const url = new URL(authorizeUrl({ ...base, kind: "github" }, "state123"));
    expect(url.origin).toBe("https://github.com");
    expect(url.pathname).toBe("/login/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("cid");
    expect(url.searchParams.get("state")).toBe("state123");
  });

  test("codeberg and self-hosted forgejo", () => {
    expect(authorizeUrl({ ...base, kind: "codeberg" }, "s")).toStartWith(
      "https://codeberg.org/login/oauth/authorize",
    );
    expect(
      authorizeUrl({ ...base, kind: "forgejo", baseUrl: "https://git.example" }, "s"),
    ).toStartWith("https://git.example/login/oauth/authorize");
  });
});

describe("exchangeCode", () => {
  test("posts code and maps token response", async () => {
    const { mockFetch, requests } = createMockFetch([
      {
        method: "POST",
        url: "/login/oauth/access_token",
        response: { access_token: "at", refresh_token: "rt", expires_in: 3600 },
      },
    ]);
    const before = Date.now();
    const tokens = await exchangeCode({ ...base, kind: "github", fetch: mockFetch }, "code1");
    expect(tokens.accessToken).toBe("at");
    expect(tokens.refreshToken).toBe("rt");
    expect(tokens.expiresAt).toBeGreaterThanOrEqual(before + 3600 * 1000);
    expect(requests[0]?.body).toMatchObject({
      grant_type: "authorization_code",
      code: "code1",
      client_id: "cid",
    });
  });

  test("throws when github returns 200 with error body", async () => {
    const { mockFetch } = createMockFetch([
      {
        method: "POST",
        url: "/login/oauth/access_token",
        response: { error: "bad_verification_code" },
      },
    ]);
    await expect(
      exchangeCode({ ...base, kind: "github", fetch: mockFetch }, "stale"),
    ).rejects.toThrow("bad_verification_code");
  });
});

describe("refreshToken", () => {
  test("posts refresh grant", async () => {
    const { mockFetch, requests } = createMockFetch([
      {
        method: "POST",
        url: "/login/oauth/access_token",
        response: { access_token: "at2", refresh_token: "rt2" },
      },
    ]);
    const tokens = await refreshToken({ ...base, kind: "codeberg", fetch: mockFetch }, "rt1");
    expect(tokens.accessToken).toBe("at2");
    expect(tokens.expiresAt).toBeUndefined();
    expect(requests[0]?.url).toStartWith("https://codeberg.org/");
    expect(requests[0]?.body).toMatchObject({ grant_type: "refresh_token", refresh_token: "rt1" });
  });
});
