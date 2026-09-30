# Deploy the writing example to Cloudflare

Configure the Worker name, content repository, private R2 bucket, and
`WRITING_SELF` binding in `code/web/wrangler.writing-test.jsonc`. The self binding
must point to this same Worker so cache warming uses the cached fetch handler.
Store `SERVICE_TOKEN` using Wrangler's secret store with that configuration;
never put a PAT in checked-in variables. The PAT needs Contents read/write for
the initialized content repository.

Run `devenv shell -- bun run deploy:writing`. The script builds workspace
packages and Astro, deploys the generated Worker configuration, then warms public
pages. It does not publish npm packages. No D1, KV, sessions, or cron bindings
are required.

Images use the private R2 binding. Optional direct browser-to-R2 uploads use the
R2 S3 credentials described in [the writing guide](writing-prototype.md); they
also work on Node. Git LFS is not implemented.

Astro's experimental Cloudflare cache provider stores whole public pages. Private
routes are no-store. Publish and delete invalidate affected tags and eagerly warm
pages; cache warming failures are returned separately from successful Git writes.
For manual GitHub changes, run `scripts/writing-warm.mjs` with `BASE_URL` set to
the deployed site.

For local Worker development, use `bun run dev:writing`; it records the allocated
URL in `code/web/.env.local`. Production cache behavior is verified against the
deployed Worker rather than inferred from development mode.
