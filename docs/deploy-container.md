# Self-host the writing example

Build with `bun run build:node`, then launch `bun run start:node` with
`SERVICE_TOKEN`, `WRITING_REPO_OWNER`, and `WRITING_REPO_NAME` in the environment.
The repository must have a `main` branch and the PAT needs Contents read/write.
The token stays on the server. Set `HOST=0.0.0.0` and a fixed `PORT` for a container.

Mount `WRITING_MEDIA_DIRECTORY` as a persistent volume. The default is
`code/web/.writing-media`. Alternatively configure `R2_ACCOUNT_ID`,
`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, and `WRITING_R2_BUCKET`; these select
R2 on Node as well as Cloudflare. Direct browser uploads require exact-origin
bucket CORS. Keep the bucket private.

Install and retain the production dependencies alongside the Node build, including
`sharp` and its platform-specific optional binaries. Astro uses Sharp for runtime
responsive WebP images; it is intentionally external to the JavaScript bundle.

The launcher warms Astro's full-page memory cache before accepting normal traffic.
The supported example is one Node process. Multiple replicas need a shared Astro
cache provider. Put HTTPS in front of the app for public hosting.

The fixed `quiescent-demo` password demonstrates an account-free example. A host
can supply its own authorization callback without changing the document store.
No database, OAuth service, cron flush, or KV draft storage is required. The
example uses a bounded in-memory document listing cache, rebuilt after restart.
Supply another `DocumentCacheStorage` adapter for shared persistent storage.
See [listing caching](document-cache.md) for the same cache contract used on D1.

See [the complete workflow and validation commands](writing-prototype.md).
