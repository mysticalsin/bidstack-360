#!/usr/bin/env bash
# Custom-format pg_dump with dated files, local retention, and optional R2
# offsite upload (S3 API). Offsite stays off unless POLO_BACKUP_S3_ENDPOINT
# and R2 access keys are set.
# Usage: scripts/backup-postgres.sh
# Env: DATABASE_URL (required), POLO_BACKUP_DIR (default ./var/backups),
#      POLO_BACKUP_RETENTION_DAYS (default 14),
#      POLO_BACKUP_S3_ENDPOINT / POLO_BACKUP_S3_ACCESS_KEY_ID /
#      POLO_BACKUP_S3_SECRET_ACCESS_KEY / POLO_BACKUP_S3_BUCKET (polo-backups),
#      POLO_BACKUP_ALERT_HOOK (optional command on failure)
set -euo pipefail

root="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/postgres-client.sh
source "$root/lib/postgres-client.sh"
# shellcheck source=lib/backup-offsite.sh
source "$root/lib/backup-offsite.sh"

on_fail() {
  polo_backup_alert "Polo Postgres backup failed"
  exit 1
}
trap on_fail ERR

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is required" >&2
  exit 1
fi

dest="${POLO_BACKUP_DIR:-./var/backups}"
keep="${POLO_BACKUP_RETENTION_DAYS:-14}"
mkdir -p "$dest"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
file="$dest/polo-${stamp}.dump"

major="$(polo_pg_server_major "$DATABASE_URL" || true)"
dump_tool="$(polo_find_pg_tool pg_dump "${major:-}")"
echo "Using $dump_tool (server major ${major:-unknown})"
"$dump_tool" --format=custom --no-owner --no-acl --file="$file" "$DATABASE_URL"
echo "Wrote $file"

if [[ "$keep" =~ ^[0-9]+$ ]] && [[ "$keep" -gt 0 ]]; then
  find "$dest" -type f -name 'polo-*.dump' -mtime "+$keep" -delete
fi

polo_offsite_upload "$file"
echo "Backup finished"
