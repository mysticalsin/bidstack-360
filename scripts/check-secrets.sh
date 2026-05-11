#!/usr/bin/env sh
# Pre-commit secret-scan. Greps the staged diff for likely credentials and
# blocks the commit if any match. Mirrors the patterns in
# .claude/hooks/scan-secrets.sh so the rule is consistent across surfaces.
#
# Allowlisted file extensions (placeholders only): .md, .env.example.
set -e

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

PATTERNS='sk-[A-Za-z0-9]{20,}|sk_live_[A-Za-z0-9]{20,}|sk_test_[A-Za-z0-9]{20,}|pk_live_[A-Za-z0-9]{20,}|whsec_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{30,}|gho_[A-Za-z0-9]{30,}|BEGIN (RSA|OPENSSH|EC|DSA) PRIVATE KEY'

HIT=$(printf "%s\n" "$ADDED" | grep -E "$PATTERNS" || true)

if [ -n "$HIT" ]; then
  echo "✋ Secret-scan blocked the commit."
  echo "   Suspicious lines (preview, masked):"
  printf "%s\n" "$HIT" | head -10 | sed -E 's/(sk-|sk_live_|sk_test_|pk_live_|whsec_|ghp_|gho_)[A-Za-z0-9]+/\1***REDACTED***/g'
  echo
  echo "   If this is a false positive, revise the snippet to not match the regex"
  echo "   (e.g. mark it as a fixture or move to .env.example)."
  echo "   This guard is non-bypassable — secrets in git history are forever."
  exit 1
fi

exit 0
