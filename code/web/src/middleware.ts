import { writingAuthor } from "./writing/app";
import { defineMiddleware } from "astro:middleware";
import {
  getSessionById,
  readCookie,
  SESSION_COOKIE,
  verifySessionCookie,
  wikiUserFromSession,
} from "@quiescent/server";

// Everything except the auth flow requires a session: quiescent is an editing
// tool, not a public site. The /demo routes are the exception — they run the
// same packages against an in-memory store and a stubbed forge, so they need
// no forge account and are what the Playwright specs drive.
export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname } = context.url;
  const writingEnv = context.locals.runtime.env;
  const editorRoute = pathname === "/write" || pathname.startsWith("/write/");
  const authorRoute = editorRoute || pathname.startsWith("/api/writing/");
  const readerRoute = pathname === "/read" || pathname.startsWith("/read/") || pathname.startsWith("/media/");
  if (writingEnv.WRITING_TEST === "true" && (pathname === "/login" || pathname.startsWith("/api/auth/"))) return next();
  if (authorRoute) {
    if (!await writingAuthor(context.request, writingEnv)) {
      return editorRoute && writingEnv.WRITING_TEST === "true"
        ? context.redirect("/login")
        : new Response("Sign in to write", {status:401});
    }
    return next();
  }
  if (readerRoute) return next();
  if ((writingEnv.WRITING_LOCAL === "true" || writingEnv.WRITING_TEST === "true") && !pathname.startsWith("/_astro/")) {
    return pathname === "/" ? context.redirect("/write") : new Response("Not found", {status:404});
  }
  if (pathname.startsWith("/auth/")) return next();
  if (pathname === "/demo" || pathname.startsWith("/demo/") || pathname.startsWith("/api/demo/")) {
    return next();
  }

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
  context.locals.user = wikiUserFromSession(session);
  return next();
});
