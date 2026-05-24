#!/usr/bin/env sh
# Secret-scan with two modes.
#
#   default:            scan the *staged* diff only (pre-commit guard).
#   --full / --tree:    scan every file tracked by `git ls-files`.
#                       Used by CI to catch secrets that crept in via a
#                       partial-revert, a branch import, or a missed hook.
#
# Mirrors the patterns enforced in .claude/hooks/scan-secrets.sh and
# .gitleaks.toml so all three surfaces stay in sync.
#
# Allowlisted file extensions (placeholders only): .md, .env.example.
set -e

MODE="staged"
if [ "${1:-}" = "--full" ] || [ "${1:-}" = "--tree" ]; then
  MODE="full"
fi

PATTERNS='sk-[A-Za-z0-9]{20,}|sk_live_[A-Za-z0-9]{20,}|sk_test_[A-Za-z0-9]{20,}|pk_live_[A-Za-z0-9]{20,}|whsec_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{30,}|gho_[A-Za-z0-9]{30,}|BEGIN (RSA|OPENSSH|EC|DSA) PRIVATE KEY'

if [ "$MODE" = "staged" ]; then
  # Get the staged diff (added/changed lines only — ignores removals).
  DIFF=$(git diff --cached --no-color --unified=0 -- ':!*.env.example' ':!*.md' || true)

  if [ -z "$DIFF" ]; then
    exit 0
  fi

  # Restrict to lines that were added (start with `+` and are not file headers).
  ADDED=$(printf "%s\n" "$DIFF" | grep -E '^\+[^+]' || true)
  if [ -z "$ADDED" ]; then
    exit 0
  fi

  HIT=$(printf "%s\n" "$ADDED" | grep -E "$PATTERNS" || true)

  if [ -n "$HIT" ]; then
    echo "Secret-scan blocked the commit."
    echo "   Suspicious lines (preview, masked):"
    printf "%s\n" "$HIT" | head -10 | sed -E 's/(sk-|sk_live_|sk_test_|pk_live_|whsec_|ghp_|gho_)[A-Za-z0-9]+/\1***REDACTED***/g'
    echo
    echo "   If this is a false positive, revise the snippet to not match the regex"
    echo "   (e.g. mark it as a fixture or move to .env.example)."
    echo "   This guard is non-bypassable — secrets in git history are forever."
    exit 1
  fi

  exit 0
fi

# ----- full-tree mode -----
# Excludes:
#   *.env.example     placeholder envs
#   *.md              documentation
#   scripts/check-secrets.sh  the scanner itself (declares patterns)
#   .claude/hooks/scan-secrets.sh  ditto
#   .gitleaks.toml    declares the patterns
#   pnpm-lock.yaml    lockfile integrity hashes false-trigger high-entropy
#   apps/api/src/security/penetration.test.ts  uses fixture-shaped strings
EXCLUDES='\.env\.example$|\.md$|^scripts/check-secrets\.sh$|^\.claude/hooks/scan-secrets\.sh$|^\.gitleaks\.toml$|^pnpm-lock\.yaml$|^apps/api/src/security/penetration\.test\.ts$|^apps/api/src/plugins/auth\.test\.ts$|^apps/api/src/routes/webhooks\.integration\.test\.ts$'

# `git ls-files` is the source of truth — only tracked files count.
FILES=$(git ls-files | grep -Ev "$EXCLUDES" || true)
if [ -z "$FILES" ]; then
  exit 0
fi

# Stream files through grep so we can attach the path to each hit. We export
# PATTERNS so the inner sh inherits it as an env var — this dodges the quoting
# nightmare of passing a regex that contains pipes through xargs.
export PATTERNS
HITS=$(printf "%s\n" "$FILES" | xargs -I{} sh -c 'grep -HEn "$PATTERNS" "$1" 2>/dev/null || true' _ {} || true)

if [ -n "$HITS" ]; then
  echo "Full-tree secret-scan found suspicious strings in committed files."
  echo
  echo "$HITS" | head -50 | sed -E 's/(sk-|sk_live_|sk_test_|pk_live_|whsec_|ghp_|gho_)[A-Za-z0-9]+/\1***REDACTED***/g'
  echo
  TOTAL=$(printf "%s\n" "$HITS" | wc -l)
  if [ "$TOTAL" -gt 50 ]; then
    echo "   ... and $((TOTAL - 50)) more matches."
  fi
  echo
  echo "   Add file paths to the EXCLUDES regex above if these are documented"
  echo "   fixtures or placeholders. Otherwise rotate the secret immediately and"
  echo "   remove it from history (git filter-repo / BFG)."
  exit 1
fi

echo "Full-tree secret scan: clean ($(printf "%s\n" "$FILES" | wc -l) files)."
exit 0
