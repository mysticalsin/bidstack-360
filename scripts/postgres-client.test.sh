#!/usr/bin/env bash
# Unit checks for version-skew restore filtering and client selection.
# No live Postgres required.
set -euo pipefail

root="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/postgres-client.sh
source "$root/lib/postgres-client.sh"
# shellcheck source=lib/backup-offsite.sh
source "$root/lib/backup-offsite.sh"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

# WHY: a PG17 client emits SET transaction_timeout = 0; PG16 rejects that
# parameter. The dump still restores (all tables match). Treating that SET as
# fatal made a successful drill look like a failed restore.
only_timeout="$(
  cat <<'EOF'
pg_restore: error: could not execute query: ERROR:  unrecognized configuration parameter "transaction_timeout"
Command was: SET transaction_timeout = 0;
EOF
)"
printf '%s\n' "$only_timeout" | polo_restore_stderr_is_only_timeout ||
  fail "timeout-only stderr must be treated as success"

mixed="$(
  cat <<'EOF'
pg_restore: error: could not execute query: ERROR:  unrecognized configuration parameter "transaction_timeout"
Command was: SET transaction_timeout = 0;
pg_restore: error: could not execute query: ERROR:  relation "missing_table" does not exist
EOF
)"
if printf '%s\n' "$mixed" | polo_restore_stderr_is_only_timeout; then
  fail "a real restore error must not be ignored"
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# polo_pg_restore must exit 0 when the fake client fails only on that SET.
fake_restore="$tmp/fake-restore"
cat >"$fake_restore" <<'EOF'
#!/usr/bin/env bash
echo 'pg_restore: error: could not execute query: ERROR:  unrecognized configuration parameter "transaction_timeout"' >&2
echo 'Command was: SET transaction_timeout = 0;' >&2
exit 1
EOF
chmod +x "$fake_restore"
polo_pg_restore "$fake_restore" --dbname=unused unused.dump >/dev/null ||
  fail "polo_pg_restore must ignore a timeout-only client failure"

fatal_restore="$tmp/fatal-restore"
cat >"$fatal_restore" <<'EOF'
#!/usr/bin/env bash
echo 'pg_restore: error: could not execute query: ERROR:  relation "missing_table" does not exist' >&2
exit 1
EOF
chmod +x "$fatal_restore"
if polo_pg_restore "$fatal_restore" --dbname=unused unused.dump >/dev/null 2>&1; then
  fail "polo_pg_restore must still fail on a real error"
fi

# Client lookup prefers a major-matched binary when it is on PATH.
cat >"$tmp/pg_restore-16" <<'EOF'
#!/usr/bin/env bash
echo matched-16
EOF
chmod +x "$tmp/pg_restore-16"
found="$(PATH="$tmp:$PATH" polo_find_pg_tool pg_restore 16)"
[[ "$found" == *pg_restore-16 ]] || fail "expected pg_restore-16, got $found"

# Offsite stays off unless endpoint + keys are set.
unset POLO_BACKUP_S3_ENDPOINT POLO_BACKUP_S3_ACCESS_KEY_ID POLO_BACKUP_S3_SECRET_ACCESS_KEY
polo_offsite_configured && fail "offsite must be disabled without env"
POLO_BACKUP_S3_ENDPOINT="https://example.r2.cloudflarestorage.com"
POLO_BACKUP_S3_ACCESS_KEY_ID="id"
POLO_BACKUP_S3_SECRET_ACCESS_KEY="secret"
polo_offsite_configured || fail "offsite must enable when endpoint and keys are set"

echo "postgres-client tests passed"
