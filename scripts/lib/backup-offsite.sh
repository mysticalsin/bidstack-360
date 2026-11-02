#!/usr/bin/env bash
# Optional Cloudflare R2 (S3 API) upload. Disabled unless endpoint + keys are set.
# Bucket defaults to polo-backups. Retention defaults to 14 days.

polo_offsite_configured() {
  [[ -n "${POLO_BACKUP_S3_ENDPOINT:-}" ]] &&
    [[ -n "${POLO_BACKUP_S3_ACCESS_KEY_ID:-}" ]] &&
    [[ -n "${POLO_BACKUP_S3_SECRET_ACCESS_KEY:-}" ]]
}

polo_offsite_upload() {
  local file="$1"
  if ! polo_offsite_configured; then
    echo "Offsite upload skipped (set POLO_BACKUP_S3_ENDPOINT and R2 access keys to enable)"
    return 0
  fi
  local bucket="${POLO_BACKUP_S3_BUCKET:-polo-backups}"
  local keep="${POLO_BACKUP_RETENTION_DAYS:-14}"
  local script_dir
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  POLO_BACKUP_S3_BUCKET="$bucket" \
    POLO_BACKUP_RETENTION_DAYS="$keep" \
    node "$script_dir/backup-offsite.mjs" "$file"
}

polo_backup_alert() {
  local msg="$1"
  echo "$msg" >&2
  if [[ -n "${POLO_BACKUP_ALERT_HOOK:-}" ]]; then
    # Hook is operator-owned (pager, Slack incoming webhook, healthchecks ping).
    # Failure of the hook must not hide the backup failure.
    if ! bash -c "$POLO_BACKUP_ALERT_HOOK" -- "$msg"; then
      echo "POLO_BACKUP_ALERT_HOOK failed" >&2
    fi
  fi
}
