#!/usr/bin/env bash
# Restore a custom-format dump created by scripts/backup-postgres.sh.
# Prefers a pg_restore whose major version matches the target server.
# A PG17 client on Postgres 16 may emit a harmless SET transaction_timeout
# error; that alone does not fail the restore.
# Usage: scripts/restore-postgres.sh /path/to/polo-YYYYMMDD.dump
# Env: POLO_RESTORE_DATABASE_URL (required) — target database, not production
#      unless the operator intentionally points it there.
set -euo pipefail

root="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/postgres-client.sh
source "$root/lib/postgres-client.sh"

dump="${1:-}"
if [[ -z "$dump" || ! -f "$dump" ]]; then
  echo "Usage: scripts/restore-postgres.sh <polo-*.dump>" >&2
  exit 1
fi
if [[ -z "${POLO_RESTORE_DATABASE_URL:-}" ]]; then
  echo "POLO_RESTORE_DATABASE_URL is required (refuse to guess the target)" >&2
  exit 1
fi

major="$(polo_pg_server_major "$POLO_RESTORE_DATABASE_URL" || true)"
restore_tool="$(polo_find_pg_tool pg_restore "${major:-}")"
echo "Using $restore_tool (server major ${major:-unknown})"
polo_pg_restore "$restore_tool" --clean --if-exists --no-owner --no-acl \
  --dbname="$POLO_RESTORE_DATABASE_URL" "$dump"
echo "Restored $dump into POLO_RESTORE_DATABASE_URL"
