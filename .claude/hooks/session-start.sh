#!/usr/bin/env bash
# Injects current git state + recent commits at session start so Claude
# knows where it left off without re-deriving from scratch.
set -euo pipefail

if ! command -v git >/dev/null 2>&1; then
  exit 0
fi

if ! git rev-parse --git-dir >/dev/null 2>&1; then
  exit 0
fi

BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
RECENT=$(git log --oneline -5 2>/dev/null || echo "no commits yet")

cat <<EOF
=== BidStack 360° — session bootstrap ===
Branch: ${BRANCH}
Recent commits:
${RECENT}

Always read MISTAKES.md before non-trivial work (Rule from architect-protocol.md).
Always read SPEC.md and CLAUDE.md if you don't have them in context.
=========================================
EOF
