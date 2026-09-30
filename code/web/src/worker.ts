import { handle } from "@astrojs/cloudflare/handler";
import { flushStaleDrafts } from "@quiescent/server";
import { writingApp, type WritingEnv } from "./writing/app";
import type { Env } from "@quiescent/server";
import type { ScheduledController, ExecutionContext } from "@cloudflare/workers-types";
export default {
  fetch: handle,
  async scheduled(_event: ScheduledController, env: Env & WritingEnv, ctx: ExecutionContext) {
    ctx.waitUntil(env.WRITING_TEST === "true"
      ? writingApp(env).service.warmCache()
      : flushStaleDrafts(env));
  },
};
