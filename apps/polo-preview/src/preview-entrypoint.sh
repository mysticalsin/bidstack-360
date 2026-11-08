#!/bin/bash
# One process tree for the Cloudflare Container. Postgres and Redis are
# local to this container. A failed start, migrate, or seed stops the box.
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
if ! touch "$LOG"; then
  echo "[polo-preview] cannot write ${LOG}" >&2
  exit 1
fi

log() {
  if ! echo "[polo-preview] $*" | tee -a "$LOG" >&2; then
    echo "[polo-preview] cannot write ${LOG}" >&2
    exit 1
  fi
}

# Migrate and the API use DATABASE_URL. A remote host would send the preview
# password and seed off this machine. Only the Postgres started here is allowed.
preview_require_local_database() {
  local url="${DATABASE_URL}"
  case "${url}" in
    postgres://*|postgresql://*) ;;
    *)
      log "DATABASE_URL must point at the preview Postgres on 127.0.0.1 or localhost"
      exit 1
      ;;
  esac
  local rest="${url#*://}"
  rest="${rest%%\?*}"
  rest="${rest%%#*}"
  rest="${rest%%/*}"
  rest="${rest##*@}"
  local host="${rest%%:*}"
  local port=""
  if [[ "${rest}" == *:* ]]; then
    port="${rest##*:}"
  fi
  if [[ "${host}" != "127.0.0.1" && "${host}" != "localhost" ]]; then
    log "DATABASE_URL must point at the preview Postgres on 127.0.0.1 or localhost"
    exit 1
  fi
  local pathpart="${url#*://}"
  pathpart="${pathpart%%\?*}"
  pathpart="${pathpart%%#*}"
  pathpart="${pathpart#*/}"
  if [[ -n "${pathpart}" && "${pathpart}" != "${POSTGRES_DB}" ]]; then
    log "DATABASE_URL database does not match POSTGRES_DB"
    exit 1
  fi
  if [[ -n "${port}" && "${port}" != "5432" ]]; then
    log "DATABASE_URL must use the preview Postgres port"
    exit 1
  fi
}

# Replace the known preview default before any child starts. The value is not logged.
# An explicit DATABASE_URL is not rebuilt from a default password.
preview_prepare_database() {
  local default_url="postgres://bidstack:bidstack@127.0.0.1:5432/bidstack"
  local url_default=0
  local pass_default=0
  if [[ "${DATABASE_URL}" == "${default_url}" ]]; then url_default=1; fi
  if [[ -z "${POSTGRES_PASSWORD}" || "${POSTGRES_PASSWORD}" == "bidstack" ]]; then pass_default=1; fi
  if [[ "${url_default}" == "1" && "${pass_default}" == "0" ]]; then
    log "POSTGRES_PASSWORD is set but DATABASE_URL is still the preview default"
    exit 1
  fi
  if [[ "${url_default}" == "0" && "${pass_default}" == "1" ]]; then
    log "DATABASE_URL is explicit and the preview password is still the default"
    exit 1
  fi
  if [[ "${url_default}" == "1" && "${pass_default}" == "1" ]]; then
    local generated=""
    generated="$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')" || {
      log "password generation failed"
      exit 1
    }
    if [[ "${#generated}" -ne 32 || ! "${generated}" =~ ^[0-9a-f]{32}$ ]]; then
      log "password generation failed"
      exit 1
    fi
    POSTGRES_PASSWORD="${generated}"
    export POSTGRES_PASSWORD
    export POSTGRES_USER="${POSTGRES_USER:-bidstack}"
    export POSTGRES_DB="${POSTGRES_DB:-bidstack}"
    export DATABASE_URL="postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@127.0.0.1:5432/${POSTGRES_DB}"
  fi
  preview_require_local_database
}

preview_child_pids=()
preview_group_pids=()
preview_stop_redis=0

preview_track() { preview_child_pids+=("$1"); }

# A leader we started with setsid owns its process group. Cleanup signals that
# group and no other pid.
preview_track_leader() {
  preview_track "$1"
  preview_group_pids+=("$1")
}

# Signal the process group we created. There is no fallback to the positive
# pid: that number can be reused by an unrelated process after the leader exits.
preview_signal_group() {
  local pid="$1"
  local sig="$2"
  kill "-${sig}" -- "-${pid}" 2>/dev/null || true
}

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
  # The redirect lives inside the check. A caller redirect that cannot open
  # the log would skip this function, and the next command would still run.
  if ! "$@" >>"$LOG" 2>&1; then
    log "${label} failed"
    exit 1
  fi
}

preview_cleanup() {
  local status=$?
  local why="${1:-exit}"
  trap - EXIT INT TERM
  local pid waits grouped leader alive
  for pid in "${preview_group_pids[@]}"; do
    [[ -n "${pid}" ]] || continue
    preview_signal_group "${pid}" TERM
  done
  for pid in "${preview_child_pids[@]}"; do
    [[ -n "${pid}" ]] || continue
    grouped=0
    for leader in "${preview_group_pids[@]}"; do
      if [[ "${leader}" == "${pid}" ]]; then grouped=1; fi
    done
    if [[ "${grouped}" == "0" ]] && kill -0 "${pid}" 2>/dev/null; then
      kill -TERM "${pid}" 2>/dev/null || true
    fi
  done
  waits=0
  while [[ "${waits}" -lt 20 ]]; do
    alive=0
    for pid in "${preview_group_pids[@]}" "${preview_child_pids[@]}"; do
      if [[ -n "${pid}" ]] && kill -0 "${pid}" 2>/dev/null; then alive=1; fi
    done
    if [[ "${alive}" == "0" ]]; then break; fi
    sleep 0.1
    waits=$((waits + 1))
  done
  for pid in "${preview_group_pids[@]}"; do
    [[ -n "${pid}" ]] || continue
    preview_signal_group "${pid}" KILL
  done
  for pid in "${preview_child_pids[@]}"; do
    [[ -n "${pid}" ]] || continue
    grouped=0
    for leader in "${preview_group_pids[@]}"; do
      if [[ "${leader}" == "${pid}" ]]; then grouped=1; fi
    done
    if [[ "${grouped}" == "0" ]] && kill -0 "${pid}" 2>/dev/null; then
      kill -KILL "${pid}" 2>/dev/null || true
    fi
    if ! kill -0 "${pid}" 2>/dev/null; then
      wait "${pid}" 2>/dev/null || true
      echo "reaped ${pid}" >>"${PREVIEW_REAP_LOG:-/dev/null}"
    fi
  done
  if [[ "${why}" == "INT" ]]; then exit 130; fi
  if [[ "${why}" == "TERM" ]]; then exit 143; fi
  exit "${status}"
}

preview_install_trap() {
  trap 'preview_cleanup exit' EXIT
  trap 'preview_cleanup INT' INT
  trap 'preview_cleanup TERM' TERM
}

preview_start_redis() {
  log "starting redis"
  setsid redis-server --daemonize no --bind 127.0.0.1 --protected-mode yes --port 6379 --save "" >>"$LOG" 2>&1 &
  local redis_pid=$!
  preview_track_leader "${redis_pid}"
  sleep 0.1
  if ! kill -0 "${redis_pid}" 2>/dev/null; then
    log "redis failed"
    exit 1
  fi
}

# Returns 0 when Postgres accepts connections inside the attempt bound.
preview_wait_postgres() {
  local pg_pid="$1"
  local attempts="${PREVIEW_POSTGRES_ATTEMPTS:-90}"
  local try
  for try in $(seq 1 "${attempts}"); do
    if pg_isready -h 127.0.0.1 -t 1 -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" >/dev/null 2>&1; then
      return 0
    fi
    if ! kill -0 "${pg_pid}" 2>/dev/null; then
      log "postgres exited before it accepted connections"
      return 1
    fi
    sleep "${PREVIEW_READY_SLEEP:-1}"
  done
  log "postgres was not ready after ${attempts} attempts"
  return 1
}

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
# The trap is installed before preparation so a failed password or URL check
# still runs cleanup. The image ENV may still contain the known preview
# database default; this script replaces that shell value before children
# start and does not write it to the log.
preview_install_trap
if [[ "${HOST}" != "127.0.0.1" && "${HOST}" != "localhost" ]]; then
  log "HOST must be 127.0.0.1 or localhost"
  exit 1
fi
preview_prepare_database
preview_stop_redis=1

node --input-type=module <<'JS' &
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const root = '/app/apps/web/dist';
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
  if (isApi(req.url || '/')) {
    const upstream = http.request(
      {
        hostname: '127.0.0.1',
        port: Number(process.env.PORT_API || 4000),
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

preview_start_redis

log "starting postgres"
setsid docker-entrypoint.sh postgres \
  -c shared_buffers=32MB \
  -c dynamic_shared_memory_type=mmap \
  -c max_connections=40 \
  >>"$LOG" 2>&1 &
pg_pid=$!
preview_track_leader "${pg_pid}"

if preview_wait_postgres "${pg_pid}"; then
  log "migrating"
  prisma_bin="$(find /app -path '*/node_modules/.bin/prisma' -print -quit || true)"
  preview_require_file "prisma binary" "${prisma_bin}"
  preview_run_or_die "migrate" "${prisma_bin}" migrate deploy --schema /app/packages/db/prisma/schema.prisma
  log "seeding"
  tsx_bin="$(find /app -path '*/node_modules/.bin/tsx' -print -quit || true)"
  preview_require_file "tsx binary" "${tsx_bin}"
  preview_seed() {
    (
      cd /app/packages/db || exit 1
      "${tsx_bin}" src/seed.ts
    )
  }
  preview_run_or_die "seed" preview_seed
  # The worker is what consumes the jobs the API enqueues. Do not leave the
  # API up when that binary was not built.
  preview_require_file "queue worker dist" /app/apps/worker/dist/main.js
  log "starting api"
  setsid bash -c 'cd /app/apps/api && exec node dist/main.js' >>"$LOG" 2>&1 &
  api_pid=$!
  preview_track_leader "${api_pid}"
  # Same database, Redis, and upload root as the API. MSA extract and crew
  # runs are queued by the API and consumed only by this process.
  log "starting queue worker"
  setsid bash -c 'cd /app/apps/worker && exec node dist/main.js' >>"$LOG" 2>&1 &
  worker_pid=$!
  preview_track_leader "${worker_pid}"
  log "queue worker ${worker_pid}"
else
  log "postgres did not become ready"
  exit 1
fi

preview_watch_children
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  preview_main
fi
