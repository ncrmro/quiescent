import type { APIRoute } from "astro";
import { authorizeUrl } from "@ncrmro/quiescent-git";
import { oauthConfig } from "../../lib/env.ts";

export const GET: APIRoute = async ({ locals, url, cookies, redirect }) => {
  const env = locals.runtime.env;
  const state = crypto.randomUUID();
  cookies.set("qs_state", state, {
    path: "/auth",
    httpOnly: true,
    secure: url.protocol === "https:",
    sameSite: "lax",
    maxAge: 600,
  });
  return redirect(authorizeUrl(oauthConfig(env, url.origin), state));
};
