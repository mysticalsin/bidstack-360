#!/usr/bin/env bash
# =============================================================================
# deploy-checklist.sh
# BidStack 360° — Pre-deploy assertions
#
# Usage: bash scripts/ops/deploy-checklist.sh [--env production|staging]
#
# Gates:
#   1. DB migration is current (no pending migrations)
#   2. Required environment variables are set
#   3. No .env files are staged/committed
#   4. No console.log in built bundle
#   5. TypeScript compiles without errors
#   6. All tests pass
#   7. Build completes successfully
#
# Exit code: 0 = all gates passed; 1 = one or more gates failed
# =============================================================================

set -uo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

FAIL_COUNT=0
WARN_COUNT=0
ENV_TARGET="${1:-production}"
ENV_FILE=".env.${ENV_TARGET}"

log_gate_pass()  { echo -e "  ${GREEN}✓ PASS${NC}  $1"; }
log_gate_fail()  { echo -e "  ${RED}✗ FAIL${NC}  $1"; ((FAIL_COUNT++)); }
log_gate_warn()  { echo -e "  ${YELLOW}⚠ WARN${NC}  $1"; ((WARN_COUNT++)); }
log_section()    { echo -e "\n${BOLD}${BLUE}=== $1 ===${NC}"; }
log_info()       { echo -e "  ${BLUE}→${NC} $1"; }

echo ""
echo -e "${BOLD}BidStack 360° — Pre-deploy Checklist${NC}"
echo -e "Target environment: ${BOLD}${ENV_TARGET}${NC}"
echo -e "Timestamp: $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
echo -e "Branch: $(git branch --show-current 2>/dev/null || echo 'unknown')"
echo -e "Commit: $(git rev-parse --short HEAD 2>/dev/null || echo 'unknown')"
echo ""

# =============================================================================
# Gate 1: No secrets committed
# =============================================================================
log_section "Gate 1: No secrets committed or staged"

# Check for .env files in git index (staged)
STAGED_ENV=$(git diff --cached --name-only 2>/dev/null | grep -E '\.env(\.[^.]+)?$' | grep -v '\.env\.example$' | grep -v '\.env\.template$' || true)
if [[ -n "$STAGED_ENV" ]]; then
  log_gate_fail ".env files are STAGED for commit: $STAGED_ENV"
else
  log_gate_pass "No .env files staged"
fi

# Check for secrets patterns in staged diff
SECRET_PATTERNS='(sk_live_|sk_test_|whsec_|pk_live_|PRIVATE KEY|BEGIN RSA|AKIA[A-Z0-9]{16})'
STAGED_SECRETS=$(git diff --cached -U0 2>/dev/null | grep -E "$SECRET_PATTERNS" | head -5 || true)
if [[ -n "$STAGED_SECRETS" ]]; then
  log_gate_fail "Potential secrets detected in staged diff (first 5 lines):"
  echo "$STAGED_SECRETS" | while IFS= read -r line; do
    echo "    $line"
  done
else
  log_gate_pass "No secret patterns found in staged changes"
fi

# Check tracked files for secrets (warn only — these may be legitimate in non-secret contexts)
TRACKED_SECRETS=$(git grep -l "$SECRET_PATTERNS" -- ':(exclude)*.example' ':(exclude)*.template' ':(exclude)scripts/ops/rotate-secrets.sh' 2>/dev/null || true)
if [[ -n "$TRACKED_SECRETS" ]]; then
  log_gate_warn "Potential secret patterns found in tracked files (review manually):"
  echo "$TRACKED_SECRETS" | while IFS= read -r f; do echo "    $f"; done
else
  log_gate_pass "No secret patterns in tracked source files"
fi

# =============================================================================
# Gate 2: Required environment variables
# =============================================================================
log_section "Gate 2: Required environment variables"

REQUIRED_VARS=(
  DATABASE_URL
  REDIS_URL
  CLERK_SECRET_KEY
  CLERK_PUBLISHABLE_KEY
  STRIPE_SECRET_KEY
  STRIPE_WEBHOOK_SECRET
  STRIPE_PUBLISHABLE_KEY
  JWT_SIGNING_PRIVATE_KEY
  JWT_SIGNING_PUBLIC_KEY
  INTEGRATION_TOKEN_KEY
  RESEND_API_KEY
  APP_URL
  CORS_ORIGINS
)

if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  set -a; source "$ENV_FILE" 2>/dev/null; set +a
  log_info "Loaded $ENV_FILE"
else
  log_gate_warn "$ENV_FILE not found — checking current environment"
fi

MISSING_VARS=()
for var in "${REQUIRED_VARS[@]}"; do
  if [[ -z "${!var:-}" ]]; then
    MISSING_VARS+=("$var")
  fi
done

if [[ ${#MISSING_VARS[@]} -gt 0 ]]; then
  log_gate_fail "Missing required environment variables: ${MISSING_VARS[*]}"
else
  log_gate_pass "All ${#REQUIRED_VARS[@]} required environment variables are set"
fi

# Warn if test keys detected in production target
if [[ "$ENV_TARGET" == "production" ]]; then
  if [[ "${STRIPE_SECRET_KEY:-}" =~ ^sk_test_ ]]; then
    log_gate_fail "STRIPE_SECRET_KEY is a TEST key — MUST be a live key for production"
  fi
  if [[ "${CLERK_PUBLISHABLE_KEY:-}" =~ _test_ ]]; then
    log_gate_warn "CLERK_PUBLISHABLE_KEY appears to be a test key — verify for production"
  fi
fi

# =============================================================================
# Gate 3: DB migration is current
# =============================================================================
log_section "Gate 3: Database migration status"

if [[ -z "${DATABASE_URL:-}" ]]; then
  log_gate_warn "DATABASE_URL not set — cannot verify migration status"
elif command -v pnpm &>/dev/null; then
  log_info "Running: pnpm exec prisma migrate status"
  MIGRATE_OUTPUT=$(pnpm exec prisma migrate status --schema=packages/db/prisma/schema.prisma 2>&1 || true)

  if echo "$MIGRATE_OUTPUT" | grep -qi "no pending migrations"; then
    log_gate_pass "No pending migrations"
  elif echo "$MIGRATE_OUTPUT" | grep -qi "database schema is up to date"; then
    log_gate_pass "Database schema is up to date"
  elif echo "$MIGRATE_OUTPUT" | grep -qi "following migrations have not yet been applied"; then
    log_gate_fail "Pending migrations detected — run pnpm db:migrate before deploying"
    echo "$MIGRATE_OUTPUT" | grep -A5 "following migrations" | head -10
  else
    log_gate_warn "Migration status unclear — review output:"
    echo "$MIGRATE_OUTPUT" | head -20
  fi
else
  log_gate_warn "pnpm not found — skipping migration check"
fi

# =============================================================================
# Gate 4: TypeScript compiles without errors
# =============================================================================
log_section "Gate 4: TypeScript type check"

if command -v pnpm &>/dev/null; then
  log_info "Running: pnpm typecheck"
  if pnpm typecheck --silent 2>&1; then
    log_gate_pass "TypeScript compiles without errors"
  else
    log_gate_fail "TypeScript errors found — fix before deploying"
  fi
else
  log_gate_warn "pnpm not found — skipping TypeScript check"
fi

# =============================================================================
# Gate 5: Tests pass
# =============================================================================
log_section "Gate 5: Test suite"

if command -v pnpm &>/dev/null; then
  log_info "Running: pnpm test (with --run flag to disable watch mode)"
  if pnpm test --run 2>&1; then
    log_gate_pass "All tests pass"
  else
    log_gate_fail "Tests failed — fix before deploying"
  fi
else
  log_gate_warn "pnpm not found — skipping test run"
fi

# =============================================================================
# Gate 6: Build succeeds + no console.log in bundle
# =============================================================================
log_section "Gate 6: Build + console.log check"

if command -v pnpm &>/dev/null; then
  log_info "Running: pnpm build"
  if pnpm build 2>&1; then
    log_gate_pass "Build completed"

    # Check built bundle for console.log
    BUNDLE_DIRS=(
      "apps/web/dist/assets"
      "apps/api/dist"
      "apps/worker/dist"
    )
    CONSOLE_LOG_FOUND=false
    for dir in "${BUNDLE_DIRS[@]}"; do
      if [[ -d "$dir" ]]; then
        HITS=$(grep -rl 'console\.log' "$dir" 2>/dev/null || true)
        if [[ -n "$HITS" ]]; then
          CONSOLE_LOG_FOUND=true
          log_gate_warn "console.log found in built bundle: $dir"
          echo "$HITS" | head -5 | while IFS= read -r f; do echo "    $f"; done
        fi
      fi
    done
    if [[ "$CONSOLE_LOG_FOUND" == "false" ]]; then
      log_gate_pass "No console.log found in built bundles"
    fi
  else
    log_gate_fail "Build failed — fix errors before deploying"
  fi
else
  log_gate_warn "pnpm not found — skipping build check"
fi

# =============================================================================
# Gate 7: Lint clean
# =============================================================================
log_section "Gate 7: Lint"

if command -v pnpm &>/dev/null; then
  log_info "Running: pnpm lint"
  if pnpm lint 2>&1; then
    log_gate_pass "Lint clean"
  else
    log_gate_fail "Lint errors found — fix or explicitly suppress with // eslint-disable-next-line + reason"
  fi
else
  log_gate_warn "pnpm not found — skipping lint"
fi

# =============================================================================
# Gate 8: No uncommitted changes to critical files
# =============================================================================
log_section "Gate 8: Clean working tree for critical files"

CRITICAL_PATHS=(
  "packages/db/prisma/schema.prisma"
  "packages/db/prisma/migrations/"
  "apps/api/src/"
  "apps/worker/src/"
)

for path in "${CRITICAL_PATHS[@]}"; do
  DIRTY=$(git status --porcelain "$path" 2>/dev/null | head -3 || true)
  if [[ -n "$DIRTY" ]]; then
    log_gate_warn "Uncommitted changes in critical path: $path"
  fi
done
log_gate_pass "Critical path check complete (see warnings above if any)"

# =============================================================================
# Summary
# =============================================================================
echo ""
log_section "Pre-deploy gate summary"
echo ""

if [[ $FAIL_COUNT -eq 0 && $WARN_COUNT -eq 0 ]]; then
  echo -e "  ${GREEN}${BOLD}ALL GATES PASSED — Safe to deploy${NC}"
  echo ""
  echo "  Post-deploy steps:"
  echo "  1. pnpm db:migrate  (if not already run separately)"
  echo "  2. Restart API + Worker services"
  echo "  3. curl https://app.bidstack.com/api/health  — expect 200"
  echo "  4. Send a Stripe test webhook → confirm 200"
  echo "  5. Log in via SSO → confirm session works"
  echo ""
  exit 0
elif [[ $FAIL_COUNT -gt 0 ]]; then
  echo -e "  ${RED}${BOLD}DEPLOY BLOCKED — $FAIL_COUNT gate(s) FAILED, $WARN_COUNT warning(s)${NC}"
  echo -e "  Fix all FAIL items before deploying."
  echo ""
  exit 1
else
  echo -e "  ${YELLOW}${BOLD}DEPLOY WITH CAUTION — 0 failures, $WARN_COUNT warning(s)${NC}"
  echo -e "  Review warnings above. If all are acceptable, deploy with awareness."
  echo ""
  exit 0
fi
