import { env, warmFetch } from "quiescent:runtime";
import { astroWriting } from "@quiescent/astro";
import type { APIRoute } from "astro";
import { writingApp, writingAuthor } from "../../../writing/app";
export const ALL: APIRoute = (context) =>
  astroWriting({
    ...writingApp(env),
    fetch: warmFetch,
    origin: context.url.origin,
    authorize: (request) => writingAuthor(request, env),
  }).api(context);
