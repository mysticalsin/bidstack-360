#!/usr/bin/env bash
# Custom-format pg_dump with dated files and retention.
# Usage: scripts/backup-postgres.sh
# Env: DATABASE_URL (required), POLO_BACKUP_DIR (default ./var/backups),
#      POLO_BACKUP_RETENTION_DAYS (default 14)
set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is required" >&2
  exit 1
fi

dest="${POLO_BACKUP_DIR:-./var/backups}"
keep="${POLO_BACKUP_RETENTION_DAYS:-14}"
mkdir -p "$dest"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
file="$dest/polo-${stamp}.dump"

pg_dump --format=custom --no-owner --no-acl --file="$file" "$DATABASE_URL"
echo "Wrote $file"

if [[ "$keep" =~ ^[0-9]+$ ]] && [[ "$keep" -gt 0 ]]; then
  find "$dest" -type f -name 'polo-*.dump' -mtime "+$keep" -delete
fi
