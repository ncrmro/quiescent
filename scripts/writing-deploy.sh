#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
WRITING_CONFIG=wrangler.writing-test.jsonc bun run build:writing
cache_schema=$(mktemp)
trap 'rm -f "$cache_schema"' EXIT
node scripts/cache-schema.mjs > "$cache_schema"
node code/web/node_modules/wrangler/bin/wrangler.js d1 execute WRITING_CACHE --config code/web/wrangler.writing-test.jsonc --remote --file "$cache_schema"
node code/web/node_modules/wrangler/bin/wrangler.js deploy --config code/web/dist/server/wrangler.json
node scripts/writing-warm.mjs
