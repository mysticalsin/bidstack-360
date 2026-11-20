#!/usr/bin/env bash
# Restore a custom-format dump created by scripts/backup-postgres.sh.
# Usage: scripts/restore-postgres.sh /path/to/polo-YYYYMMDD.dump
# Env: POLO_RESTORE_DATABASE_URL (required) — target database, not production
#      unless the operator intentionally points it there.
set -euo pipefail

dump="${1:-}"
if [[ -z "$dump" || ! -f "$dump" ]]; then
  echo "Usage: scripts/restore-postgres.sh <polo-*.dump>" >&2
  exit 1
fi
if [[ -z "${POLO_RESTORE_DATABASE_URL:-}" ]]; then
  echo "POLO_RESTORE_DATABASE_URL is required (refuse to guess the target)" >&2
  exit 1
fi

pg_restore --clean --if-exists --no-owner --no-acl --dbname="$POLO_RESTORE_DATABASE_URL" "$dump"
echo "Restored $dump into POLO_RESTORE_DATABASE_URL"
