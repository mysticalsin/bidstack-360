#!/usr/bin/env bash
# Creates a throwaway database, dumps it, restores into a second throwaway
# database, and compares public-table row counts. Uses only synthetic names.
set -euo pipefail

# Filter / client-selection checks do not need a live database.
bash "$(dirname "$0")/postgres-client.test.sh"

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is required" >&2
  exit 1
fi

admin_url="${POLO_BACKUP_ADMIN_DATABASE_URL:-$DATABASE_URL}"
suffix="$(date -u +%s)_$$"
src="polo_backup_selftest_src_${suffix}"
dst="polo_backup_selftest_dst_${suffix}"
workdir="${TMPDIR:-/tmp}/polo-backup-selftest-${suffix}"
mkdir -p "$workdir"

cleanup() {
  psql "$admin_url" -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS ${src};" >/dev/null 2>&1 || true
  psql "$admin_url" -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS ${dst};" >/dev/null 2>&1 || true
  rm -rf "$workdir"
}
trap cleanup EXIT

createdb_from() {
  local name="$1"
  psql "$admin_url" -v ON_ERROR_STOP=1 -c "CREATE DATABASE ${name};"
}

createdb_from "$src"
src_url="$(node -e "const u=new URL(process.env.DATABASE_URL); u.pathname='/${src}'; process.stdout.write(u.toString())")"
dst_url="$(node -e "const u=new URL(process.env.DATABASE_URL); u.pathname='/${dst}'; process.stdout.write(u.toString())")"

psql "$src_url" -v ON_ERROR_STOP=1 -c "CREATE TABLE polo_selftest (id int primary key, label text); INSERT INTO polo_selftest VALUES (1, 'synthetic');"

export DATABASE_URL="$src_url"
export POLO_BACKUP_DIR="$workdir"
export POLO_BACKUP_RETENTION_DAYS=1
bash "$(dirname "$0")/backup-postgres.sh"
dump="$(ls -1 "$workdir"/polo-*.dump | head -n 1)"

createdb_from "$dst"
export POLO_RESTORE_DATABASE_URL="$dst_url"
bash "$(dirname "$0")/restore-postgres.sh" "$dump"

src_count="$(psql "$src_url" -tAc 'select count(*) from polo_selftest')"
dst_count="$(psql "$dst_url" -tAc 'select count(*) from polo_selftest')"
if [[ "$src_count" != "$dst_count" ]]; then
  echo "Row-count mismatch: src=$src_count dst=$dst_count" >&2
  exit 1
fi
echo "backup-restore selftest passed ($src_count row)"
