import { defineMiddleware } from "astro:middleware";
import {
  getSessionById,
  readCookie,
  SESSION_COOKIE,
  verifySessionCookie,
} from "@ncrmro/quiescent-server";

// Everything except the auth flow requires a session: quiescent is an editing
// tool, not a public site.
export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname } = context.url;
  if (pathname.startsWith("/auth/")) return next();

  const env = context.locals.runtime.env;
  const cookie = readCookie(context.request.headers.get("Cookie"), SESSION_COOKIE);
  const sessionId = cookie ? await verifySessionCookie(env, cookie) : null;
  const session = sessionId ? await getSessionById(env, sessionId) : null;

  if (!sessionId || !session) {
    if (pathname.startsWith("/api/")) {
      return new Response(JSON.stringify({ error: "unauthenticated" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    return context.redirect("/auth/login");
  }

  context.locals.session = session;
  context.locals.sessionId = sessionId;
  return next();
});
