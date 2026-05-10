#!/usr/bin/env bash
# PreToolUse hook for Bash. Reads the proposed command from stdin (jq),
# blocks dangerous patterns. Exit 0 = allow, exit 1 = block.
set -euo pipefail

if ! command -v jq >/dev/null 2>&1; then
  echo "WARN: jq not installed; dangerous-command guard disabled" >&2
  exit 0
fi

INPUT=$(cat)
CMD=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

if [ -z "$CMD" ]; then
  exit 0
fi

# Patterns to hard-block (Rule 13)
BLOCKED=(
  '^rm -rf /[^t]'                  # rm -rf / (anything but /tmp)
  '^rm -rf ~'                      # rm -rf home
  'git push +-+f($| )'             # force push
  'git push +--force($| )'         # force push (long flag)
  'git reset +--hard +origin/'     # reset hard to remote (drops local work)
  'curl +[^|]+\| *(bash|sh)'       # curl | bash
  'wget +[^|]+\| *(bash|sh)'       # wget | bash
  'DROP +(TABLE|DATABASE|SCHEMA)'  # destructive SQL
  'TRUNCATE +TABLE'                # destructive SQL
)

for pattern in "${BLOCKED[@]}"; do
  if echo "$CMD" | grep -Eqi "$pattern"; then
    cat <<EOF >&2
🚨 BLOCKED — dangerous command pattern matched: ${pattern}
Command: ${CMD}

This is enforced by .claude/hooks/block-dangerous-commands.sh per Rule 13.
If you genuinely need to run this, ask Tony to approve the specific operation
out-of-band; do not loop until you find a way through.
EOF
    exit 1
  fi
done

exit 0
