import { env } from "cloudflare:workers";
import type { APIRoute } from "astro";
import {
  deleteSession,
  readCookie,
  SESSION_COOKIE,
  verifySessionCookie,
} from "@quiescent/server";

export const POST: APIRoute = async ({ locals, request, cookies, redirect }) => {

  const cookie = readCookie(request.headers.get("Cookie"), SESSION_COOKIE);
  const sessionId = cookie ? await verifySessionCookie(env, cookie) : null;
  if (sessionId) await deleteSession(env, sessionId);
  cookies.delete(SESSION_COOKIE, { path: "/" });
  return redirect("/auth/login");
};
