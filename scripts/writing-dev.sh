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
port=$(node --input-type=module - <<'JS'
import net from 'node:net';
import fs from 'node:fs';
let port = Number(process.env.DEV_PORT || (fs.existsSync('.env.local') ? fs.readFileSync('.env.local','utf8').match(/^DEV_PORT=(\d+)$/m)?.[1] : undefined) || 4180);
const available = p => new Promise(resolve => { const s = net.createServer(); s.once('error',()=>resolve(false)); s.listen(p,'127.0.0.1',()=>s.close(()=>resolve(true))); });
while (!await available(port)) port++;
fs.writeFileSync('.env.local',`DEV_PORT=${port}\nDEV_URL=http://127.0.0.1:${port}\n`);
console.log(port);
JS
)
args=()
if [ -n "${WRITING_SECRETS_FILE:-}" ]; then args+=(--env-file "$WRITING_SECRETS_FILE"); fi
echo "$$" > .writing-server.pid
exec node node_modules/wrangler/bin/wrangler.js dev "${args[@]}" --config wrangler.writing.jsonc --ip 127.0.0.1 --port "$port" --inspector-port 0
