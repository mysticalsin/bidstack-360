#!/usr/bin/env bash
# PreToolUse hook for Write/Edit. Reads proposed file content from stdin,
# blocks if it contains likely secrets. Exit 0 = allow, exit 1 = block.
set -euo pipefail

if ! command -v jq >/dev/null 2>&1; then
  echo "WARN: jq not installed; secret-scan guard disabled" >&2
  exit 0
fi

INPUT=$(cat)
PATH_=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')
CONTENT=$(echo "$INPUT" | jq -r '.tool_input.content // .tool_input.new_string // empty')

if [ -z "$CONTENT" ]; then
  exit 0
fi

# Skip the obvious non-secrets locations
case "$PATH_" in
  *.env.example|*CLAUDE.md|*SPEC.md|*MISTAKES.md|*PROGRESS.md|*README.md|*.md)
    # Allow markdown + .env.example (which by definition holds placeholders)
    exit 0
    ;;
esac

# Common secret patterns
PATTERNS=(
  'sk-[A-Za-z0-9_-]{20,}'                      # OpenAI / Anthropic modern keys
  'sk_live_[A-Za-z0-9]{20,}'                   # Stripe live
  'sk_test_[A-Za-z0-9]{20,}'                   # Stripe test
  'pk_live_[A-Za-z0-9]{20,}'                   # Stripe live publishable
  'whsec_[A-Za-z0-9]{20,}'                     # Webhook secrets
  'AKIA[0-9A-Z]{16}'                           # AWS access key
  'ghp_[A-Za-z0-9]{30,}'                       # GitHub personal token
  'gho_[A-Za-z0-9]{30,}'                       # GitHub OAuth
  'github_pat_[A-Za-z0-9_]{30,}'               # GitHub fine-grained PAT
  'xox[baprs]-[A-Za-z0-9-]{20,}'               # Slack tokens
  'AIza[0-9A-Za-z_-]{35}'                      # Google API keys
  'AccountKey=[A-Za-z0-9+/=]{40,}'             # Azure Storage connection strings
  'eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}'  # JWT
  'BEGIN (RSA|OPENSSH|EC|DSA) PRIVATE KEY'     # private keys
)

for pattern in "${PATTERNS[@]}"; do
  if echo "$CONTENT" | grep -Eq "$pattern"; then
    cat <<EOF >&2
🚨 BLOCKED — likely secret detected matching pattern: ${pattern}
File: ${PATH_}

This is enforced by .claude/hooks/scan-secrets.sh per Rule 14.
Move the value to .env (NOT .env.example) and reference via process.env.
EOF
    exit 1
  fi
done

exit 0
