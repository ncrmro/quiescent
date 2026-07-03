import type { APIRoute } from "astro";
import { createForge, exchangeCode } from "@ncrmro/quiescent-git";
import { forgeConfig, oauthConfig } from "../../lib/env.ts";
import { createSession, SESSION_COOKIE, sessionCookieValue } from "../../lib/session.ts";

export const GET: APIRoute = async ({ locals, url, cookies, redirect }) => {
  const env = locals.runtime.env;
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expectedState = cookies.get("qs_state")?.value;
  cookies.delete("qs_state", { path: "/auth" });

  // SECURITY: state check blocks OAuth CSRF (attacker-initiated code injection).
  if (!code || !state || !expectedState || state !== expectedState) {
    return new Response("Invalid OAuth state", { status: 400 });
  }

  const tokens = await exchangeCode(oauthConfig(env, url.origin), code);
  const forge = createForge(forgeConfig(env, tokens.accessToken));
  const user = await forge.getUser();
  const permissions = await forge.getRepoPermissions();

  const sessionId = await createSession(env, {
    userId: user.id,
    login: user.login,
    canPush: permissions.push,
    tokens,
  });
  cookies.set(SESSION_COOKIE, await sessionCookieValue(env, sessionId), {
    path: "/",
    httpOnly: true,
    secure: url.protocol === "https:",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 30,
  });
  return redirect("/");
};
