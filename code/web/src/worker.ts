import { handle } from "@astrojs/cloudflare/handler";
import type { SSRManifest } from "astro";
import { App } from "astro/app";
import type { ExecutionContext, Request as WorkersRequest, ScheduledController } from "@cloudflare/workers-types";
import { flushStaleDrafts } from "@ncrmro/quiescent-server";
import type { Env } from "@ncrmro/quiescent-server";

export function createExports(manifest: SSRManifest) {
  const app = new App(manifest);
  return {
    default: {
      async fetch(request: WorkersRequest, env: Env, ctx: ExecutionContext) {
        // @ts-expect-error the adapter handler's generated types use the global Request/env shapes
        return handle(manifest, app, request, env, ctx);
      },
      async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
        ctx.waitUntil(flushStaleDrafts(env));
      },
    },
  };
}
