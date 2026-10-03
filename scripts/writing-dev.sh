#!/usr/bin/env bash
set -euo pipefail
# Workerd must trust the host CA bundle, including locally installed roots.
if [ -z "${NODE_EXTRA_CA_CERTS:-}" ] && [ -f /etc/ssl/certs/ca-certificates.crt ]; then
  export NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt
fi
cd "$(dirname "$0")/../code/web"
if [ -f .writing-server.pid ]; then
  previous=$(cat .writing-server.pid)
  if [[ "$previous" =~ ^[0-9]+$ ]] && kill -0 "$previous" 2>/dev/null && [ "$(readlink "/proc/$previous/cwd" 2>/dev/null)" = "$PWD" ]; then
    echo "Writing server already running (PID $previous); see $PWD/.env.local."
    exit 0
  fi
fi
export WRITING_HOST="${WRITING_HOST:-127.0.0.1}"
port=$(node ../../scripts/writing-port.mjs)
args=()
if [ -n "${WRITING_SECRETS_FILE:-}" ]; then args+=(--env-file "$WRITING_SECRETS_FILE"); fi
if [ -n "${WRITING_ALLOWED_ORIGINS:-}" ]; then args+=(--var "WRITING_ALLOWED_ORIGINS:$WRITING_ALLOWED_ORIGINS"); fi
WRITING_CONFIG=wrangler.writing.jsonc node node_modules/.bin/astro build
node node_modules/wrangler/bin/wrangler.js d1 execute WRITING_CACHE --config wrangler.writing.jsonc --local --file ../server/src/documents-cache.schema.sql
echo "$$" > .writing-server.pid
exec node node_modules/wrangler/bin/wrangler.js dev "${args[@]}" --config dist/server/wrangler.json --ip "$WRITING_HOST" --port "$port" --inspector-port 0
