import type { APIRoute } from "astro";
import {
  deleteSession,
  readCookie,
  SESSION_COOKIE,
  verifySessionCookie,
} from "../../lib/session.ts";

export const POST: APIRoute = async ({ locals, request, cookies, redirect }) => {
  const env = locals.runtime.env;
  const cookie = readCookie(request.headers.get("Cookie"), SESSION_COOKIE);
  const sessionId = cookie ? await verifySessionCookie(env, cookie) : null;
  if (sessionId) await deleteSession(env, sessionId);
  cookies.delete(SESSION_COOKIE, { path: "/" });
  return redirect("/auth/login");
};
