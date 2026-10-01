import { defineMiddleware } from "astro:middleware";
import { env } from "quiescent:runtime";
import { writingAuthor } from "./writing/auth";

export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname } = context.url;
  const editor =
    /^\/write\/?$/.test(pathname) ||
    /^\/(posts|recipes)\/new\/?$/.test(pathname) ||
    /^\/(posts|recipes)\/[^/]+\/edit\/?$/.test(pathname);
  const author = editor || pathname.startsWith("/api/documents/");
  const privateRoute =
    author ||
    pathname === "/login" ||
    pathname.startsWith("/api/auth/") ||
    pathname.startsWith("/_server-islands/");
  if (privateRoute) context.cache.set(false);
  if (author && !(await writingAuthor(context.request, env))) {
    const response = editor
      ? context.redirect("/login")
      : new Response("Sign in to write", { status: 401 });
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
  const response = await next();
  if (privateRoute) response.headers.set("Cache-Control", "private, no-store");
  return response;
});
