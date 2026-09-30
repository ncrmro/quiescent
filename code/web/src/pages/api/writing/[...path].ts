import {env,warmFetch} from "quiescent:runtime";
import type {APIRoute} from "astro";
import {astroWriting} from "@quiescent/server";
import {writingApp,writingAuthor} from "../../../writing/app";
export const ALL:APIRoute=context=>astroWriting({
  ...writingApp(env),fetch:warmFetch,origin:context.url.origin,authorize:request=>writingAuthor(request,env),
}).api(context);
