#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
WRITING_CONFIG=wrangler.writing-test.jsonc bun run build:writing
node code/web/node_modules/wrangler/bin/wrangler.js deploy --config code/web/dist/server/wrangler.json
node scripts/writing-warm.mjs
