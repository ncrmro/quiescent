import {handle} from "@astrojs/cloudflare/handler";
import {flushStaleDrafts,type Env} from "@quiescent/server";
import type {ScheduledController,ExecutionContext} from "@cloudflare/workers-types";
export default {
  fetch:handle,
  async scheduled(_event:ScheduledController,env:Env,ctx:ExecutionContext){ctx.waitUntil(flushStaleDrafts(env));},
};
