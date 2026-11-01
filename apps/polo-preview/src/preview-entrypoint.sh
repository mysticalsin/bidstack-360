#!/bin/bash
# One process tree for the Cloudflare Container. A Node listener on 8080
# stays up even when Postgres is still booting, and /__boot shows the log.
set -uo pipefail

export PATH="/usr/local/bin:${PATH}"
export NODE_ENV="${NODE_ENV:-development}"
export PORT_API="${PORT_API:-4000}"
export HOST="${HOST:-127.0.0.1}"
export DATABASE_URL="${DATABASE_URL:-postgres://bidstack:bidstack@127.0.0.1:5432/bidstack}"
export REDIS_URL="${REDIS_URL:-redis://127.0.0.1:6379}"
export PUBLIC_BASE_URL="${PUBLIC_BASE_URL:-https://polo-preview.tony-walteur.workers.dev}"
export PUBLIC_API_URL="${PUBLIC_API_URL:-${PUBLIC_BASE_URL}}"
export POSTGRES_USER="${POSTGRES_USER:-bidstack}"
export POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-bidstack}"
export POSTGRES_DB="${POSTGRES_DB:-bidstack}"

LOG=/tmp/polo-boot.log
touch "$LOG"

log() { echo "[polo-preview] $*" | tee -a "$LOG" >&2; }

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

function sendFile(res, file) {
  fs.readFile(file, (error, body) => {
    if (error) {
      res.statusCode = 404;
      res.end('not found');
      return;
    }
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
  if [[ -n "${prisma_bin}" ]]; then
    "${prisma_bin}" migrate deploy --schema /app/packages/db/prisma/schema.prisma >>"$LOG" 2>&1 || log "migrate failed"
  else
    log "prisma binary missing"
  fi
  log "seeding"
  tsx_bin="$(find /app -path '*/node_modules/.bin/tsx' -print -quit || true)"
  if [[ -n "${tsx_bin}" ]]; then
    (cd /app/packages/db && "${tsx_bin}" src/seed.ts) >>"$LOG" 2>&1 || log "seed failed"
  else
    log "tsx binary missing"
  fi
  log "starting api"
  (cd /app/apps/api && node dist/main.js) >>"$LOG" 2>&1 &
  api_pid=$!
else
  log "postgres did not become ready"
fi

wait "${node_pid}"
