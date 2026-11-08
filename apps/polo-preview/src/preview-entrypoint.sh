#!/bin/bash
# One process tree for the Cloudflare Container. A Node listener on 8080
# stays up even when Postgres is still booting, and /__boot shows the log.
set -uo pipefail

export PATH="/usr/local/bin:${PATH}"
export NODE_ENV="${NODE_ENV:-development}"
export PORT_API="${PORT_API:-4000}"
export HOST="${HOST:-127.0.0.1}"
# Preview-only defaults for the Postgres and Redis this container starts.
# They are local to the preview, not production credentials.
export DATABASE_URL="${DATABASE_URL:-postgres://bidstack:bidstack@127.0.0.1:5432/bidstack}"
export REDIS_URL="${REDIS_URL:-redis://127.0.0.1:6379}"
export PUBLIC_BASE_URL="${PUBLIC_BASE_URL:-https://polo-preview.tony-walteur.workers.dev}"
export PUBLIC_API_URL="${PUBLIC_API_URL:-${PUBLIC_BASE_URL}}"
export POSTGRES_USER="${POSTGRES_USER:-bidstack}"
export POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-bidstack}"
export POSTGRES_DB="${POSTGRES_DB:-bidstack}"

LOG="${LOG:-/tmp/polo-boot.log}"
touch "$LOG"

log() { echo "[polo-preview] $*" | tee -a "$LOG" >&2; }

preview_child_pids=()
preview_stop_redis=0

preview_track() { preview_child_pids+=("$1"); }

preview_require_file() {
  local label="$1"
  local path="$2"
  if [[ ! -f "${path}" ]]; then
    log "${label} missing; API will not start"
    exit 1
  fi
}

preview_run_or_die() {
  local label="$1"
  shift
  if ! "$@"; then
    log "${label} failed"
    exit 1
  fi
}

preview_cleanup() {
  local status=$?
  trap - EXIT INT TERM
  local pid
  for pid in "${preview_child_pids[@]}"; do
    if [[ -n "${pid}" ]] && kill -0 "${pid}" 2>/dev/null; then
      echo "reaped ${pid}" >>"${PREVIEW_REAP_LOG:-/dev/null}"
      kill "${pid}" 2>/dev/null || true
    fi
  done
  for pid in "${preview_child_pids[@]}"; do
    wait "${pid}" 2>/dev/null || true
  done
  if [[ "${preview_stop_redis}" == "1" ]] && command -v redis-cli >/dev/null 2>&1; then
    redis-cli -h 127.0.0.1 -p 6379 shutdown nosave >/dev/null 2>&1 || true
  fi
  exit "${status}"
}

preview_install_trap() { trap preview_cleanup EXIT INT TERM; }

# The first child to exit fails the container. The EXIT trap reaps the rest.
preview_watch_children() {
  local status=0
  wait -n || status=$?
  if [[ "${status}" -eq 0 ]]; then
    log "a preview process exited"
    status=1
  else
    log "a preview process exited (${status})"
  fi
  return "${status}"
}

preview_main() {
preview_install_trap
preview_stop_redis=1

node --input-type=module <<'JS' &
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const root = '/app/apps/web/dist';
const logFile = '/tmp/polo-boot.log';
const apiPrefixes = ['/api', '/readyz', '/livez', '/health', '/metrics', '/webhooks'];

function isApi(url) {
  const pathname = url.split('?')[0];
  return apiPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

function sendFile(res, file) {
  fs.readFile(file, (error, body) => {
    if (error) {
      res.statusCode = 404;
      res.end('not found');
      return;
    }
    const ext = path.extname(file).toLowerCase();
    res.setHeader('content-type', types[ext] || 'application/octet-stream');
    res.end(body);
  });
}

const server = http.createServer((req, res) => {
  const pathname = (req.url || '/').split('?')[0];
  if (pathname === '/__boot') {
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.end(fs.existsSync(logFile) ? fs.readFileSync(logFile) : 'no log');
    return;
  }
  if (isApi(req.url || '/')) {
    const upstream = http.request(
      {
        hostname: '127.0.0.1',
        port: 4000,
        path: req.url,
        method: req.method,
        headers: req.headers,
      },
      (up) => {
        res.writeHead(up.statusCode || 502, up.headers);
        up.pipe(res);
      },
    );
    upstream.on('error', () => {
      res.statusCode = 502;
      res.end('api down');
    });
    req.pipe(upstream);
    return;
  }
  const safe = path.normalize(pathname).replace(/^(\.\.[/\\])+/, '');
  const file = path.join(root, safe);
  fs.stat(file, (error, stat) => {
    if (!error && stat.isFile()) {
      sendFile(res, file);
      return;
    }
    sendFile(res, path.join(root, 'index.html'));
  });
});

server.listen(8080, '0.0.0.0');
JS
node_pid=$!
preview_track "${node_pid}"

log "node listener $node_pid"
log "id $(id)"
log "shm $(df -h /dev/shm 2>/dev/null | tail -1)"

log "starting redis"
if ! redis-server --daemonize yes --bind 127.0.0.1 --protected-mode yes --port 6379 --save "" >>"$LOG" 2>&1; then
  log "redis failed"
fi

log "starting postgres"
docker-entrypoint.sh postgres \
  -c shared_buffers=32MB \
  -c dynamic_shared_memory_type=mmap \
  -c max_connections=40 \
  >>"$LOG" 2>&1 &
pg_pid=$!
preview_track "${pg_pid}"

ready=0
for _ in $(seq 1 90); do
  if pg_isready -h 127.0.0.1 -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" >/dev/null 2>&1; then
    ready=1
    break
  fi
  if ! kill -0 "${pg_pid}" 2>/dev/null; then
    log "postgres exited before it accepted connections"
    break
  fi
  sleep 1
done

if [[ "${ready}" == "1" ]]; then
  log "migrating"
  prisma_bin="$(find /app -path '*/node_modules/.bin/prisma' -print -quit || true)"
  preview_require_file "prisma binary" "${prisma_bin}"
  preview_run_or_die "migrate" "${prisma_bin}" migrate deploy --schema /app/packages/db/prisma/schema.prisma >>"$LOG" 2>&1
  log "seeding"
  tsx_bin="$(find /app -path '*/node_modules/.bin/tsx' -print -quit || true)"
  preview_require_file "tsx binary" "${tsx_bin}"
  preview_run_or_die "seed" bash -c "cd /app/packages/db && \"${tsx_bin}\" src/seed.ts" >>"$LOG" 2>&1
  # The worker is what consumes the jobs the API enqueues. Do not leave the
  # API up when that binary was not built.
  preview_require_file "queue worker dist" /app/apps/worker/dist/main.js
  log "starting api"
  (cd /app/apps/api && node dist/main.js) >>"$LOG" 2>&1 &
  api_pid=$!
  preview_track "${api_pid}"
  # Same database, Redis, and upload root as the API. MSA extract and crew
  # runs are queued by the API and consumed only by this process.
  log "starting queue worker"
  (cd /app/apps/worker && node dist/main.js) >>"$LOG" 2>&1 &
  worker_pid=$!
  preview_track "${worker_pid}"
  log "queue worker ${worker_pid}"
else
  log "postgres did not become ready"
fi

preview_watch_children
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  preview_main
fi
