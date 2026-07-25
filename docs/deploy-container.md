# Deploying a quiescent wiki in a container (Node)

The packages are deployment-agnostic: `Env` is a plain object of
`KeyValueStore`s + config, and everything `quiescentWiki()` bakes at build
time works identically under `@astrojs/node`.

## Adapter

```js
// astro.config.mjs
import node from "@astrojs/node";
export default defineConfig({
  output: "server",
  adapter: node({ mode: "standalone" }),
  integrations: [quiescentWiki({ dir: fileURLToPath(new URL("../wiki", import.meta.url)) })],
});
```

## Env construction

Build the `Env` once at startup and hand it to your middleware/routes
(instead of `locals.runtime.env`):

```ts
import { createMemoryStore, type Env } from "@quiescent/server";

export const env: Env = {
  DRAFTS: createMemoryStore(),          // see storage options below
  FORGE_KIND: "github",
  REPO_OWNER: process.env.REPO_OWNER!,
  REPO_NAME: process.env.REPO_NAME!,
  DEFAULT_BRANCH: "main",
  SERVICE_TOKEN: process.env.SERVICE_TOKEN,
};
```

### Draft storage

- `createMemoryStore()` — single process only; **drafts are lost on
  restart/redeploy**. Acceptable when the flush interval is short.
- Redis — the `KeyValueStore` interface is ~4 methods; an implementation is
  ~40 lines:

```ts
import { createClient } from "redis";
import type { KeyValueStore } from "@quiescent/server";

export async function createRedisStore(url: string): Promise<KeyValueStore> {
  const redis = createClient({ url });
  await redis.connect();
  return {
    async get(key) {
      return redis.get(key);
    },
    async put(key, value, options) {
      if (options?.expirationTtl) await redis.set(key, value, { EX: options.expirationTtl });
      else await redis.set(key, value);
    },
    async delete(key) {
      await redis.del(key);
    },
    async list(options) {
      // SCAN-based paging; fine at wiki scale.
      const reply = await redis.scan(Number(options?.cursor ?? "0"), {
        MATCH: `${options?.prefix ?? ""}*`,
        COUNT: 100,
      });
      return {
        keys: reply.keys.map((name) => ({ name })),
        list_complete: reply.cursor === 0,
        cursor: reply.cursor === 0 ? undefined : String(reply.cursor),
      };
    },
  };
}
```

## Flush cadence (no Workers cron)

Either an in-process interval in the server entry:

```ts
import { flushStaleDrafts } from "@quiescent/server";
setInterval(() => flushStaleDrafts(env).catch(console.error), 60_000);
```

…or an external cron hitting a bearer-guarded flush route:

```ts
// pages/api/flush-all.ts
export const POST: APIRoute = async ({ request }) => {
  if (request.headers.get("Authorization") !== `Bearer ${process.env.FLUSH_SECRET}`) {
    return new Response(null, { status: 401 });
  }
  await flushStaleDrafts(env);
  return new Response(JSON.stringify({ ok: true }));
};
```

```
*/5 * * * * curl -s -X POST -H "Authorization: Bearer $FLUSH_SECRET" http://wiki:4321/api/flush-all
```

## Dockerfile

```dockerfile
FROM oven/bun:1 AS build
WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile
RUN bun run build          # astro build

FROM node:22-slim
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
ENV HOST=0.0.0.0 PORT=4321
EXPOSE 4321
CMD ["node", "./dist/server/entry.mjs"]
```

Redeploy-on-wiki-push applies here too (content is baked at build time):
rebuild the image when `wiki/**` changes, or mount the wiki directory and
restart — the index is computed during `astro build`, so a bind mount alone
is not enough.
