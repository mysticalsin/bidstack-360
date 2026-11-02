#!/usr/bin/env bash
# Shared helpers for scripts/backup-postgres.sh and scripts/restore-postgres.sh.
# Prefer a pg_dump/pg_restore whose major version matches the server. When the
# only client is newer, ignore the known-harmless PG17 SET transaction_timeout
# error on a PG16 (or older) server.

polo_pg_server_major() {
  local url="$1"
  psql "$url" -tAc "SHOW server_version" | head -n 1 | tr -d '[:space:]' | cut -d. -f1
}

# Print the first executable matching $1 (pg_dump|pg_restore) for major $2.
polo_find_pg_tool() {
  local tool="$1"
  local major="$2"
  local cand
  for cand in \
    "${tool}-${major}" \
    "/usr/lib/postgresql/${major}/bin/${tool}" \
    "/usr/pgsql-${major}/bin/${tool}" \
    "/opt/homebrew/opt/postgresql@${major}/bin/${tool}" \
    "/usr/local/opt/postgresql@${major}/bin/${tool}"; do
    if command -v "$cand" >/dev/null 2>&1 || [[ -x "$cand" ]]; then
      if [[ -x "$cand" ]]; then
        printf '%s\n' "$cand"
      else
        command -v "$cand"
      fi
      return 0
    fi
  done
  command -v "$tool"
}

# True when every non-empty stderr line is the known unsupported
# transaction_timeout SET (PG17 client on PG16-or-older server).
polo_restore_stderr_is_only_timeout() {
  local line leftover=0
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -z "${line// /}" ]] && continue
    if [[ "$line" == *transaction_timeout* ]]; then
      continue
    fi
    leftover=1
    break
  done
  [[ "$leftover" -eq 0 ]]
}

# Run pg_restore. Exit 0 when the only errors are the transaction_timeout SET.
# Other pg_restore failures stay non-zero. Args after the tool path are
# forwarded to pg_restore.
polo_pg_restore() {
  local tool="$1"
  shift
  local err
  err="$(mktemp)"
  local rc=0
  "$tool" "$@" 2>"$err" || rc=$?
  if [[ "$rc" -eq 0 ]]; then
    cat "$err" >&2 || true
    rm -f "$err"
    return 0
  fi
  if polo_restore_stderr_is_only_timeout <"$err"; then
    echo "Ignoring unsupported transaction_timeout SET from a newer pg_restore client" >&2
    cat "$err" >&2 || true
    rm -f "$err"
    return 0
  fi
  cat "$err" >&2 || true
  rm -f "$err"
  return "$rc"
}
