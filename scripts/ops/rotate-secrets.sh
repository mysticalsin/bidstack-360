#!/usr/bin/env bash
# =============================================================================
# rotate-secrets.sh
# BidStack 360° — Quarterly Secret Rotation Runbook
#
# Usage: bash scripts/ops/rotate-secrets.sh
#
# Rotates:
#   1. INTEGRATION_TOKEN_KEY (AES-256 key for stored OAuth token encryption)
#   2. VAPID keys (Web Push notifications)
#   3. Stripe webhook secret (forces a new endpoint in Stripe dashboard)
#   4. JWT signing key (with graceful overlap — old key kept valid for 1h)
#
# Overlap strategy for JWT:
#   - New key generated and set as JWT_SIGNING_KEY
#   - Old key preserved as JWT_SIGNING_KEY_PREV for 1 hour
#   - After 1h, remove JWT_SIGNING_KEY_PREV (a follow-up scheduled task)
#
# Prerequisites:
#   - .env.production exists and is the authoritative source
#   - openssl installed
#   - Stripe CLI installed (for webhook secret rotation) — optional
#   - AWS CLI (if secrets stored in AWS Secrets Manager) — optional
# =============================================================================

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

ENV_FILE=".env.production"
BACKUP_FILE=".env.production.backup.$(date +%Y%m%d_%H%M%S)"
ROTATION_LOG="docs/operations/secret-rotation.log"
TOKEN_ROTATION_SCRIPT="scripts/rotate-integration-tokens.ts"

log_info()    { echo -e "${BLUE}[INFO]${NC}  $1"; }
log_ok()      { echo -e "${GREEN}[OK]${NC}    $1"; }
log_warn()    { echo -e "${YELLOW}[WARN]${NC}  $1"; }
log_error()   { echo -e "${RED}[ERROR]${NC} $1"; }
log_section() { echo -e "\n${BOLD}${BLUE}=== $1 ===${NC}"; }

confirm() {
  local message="$1"
  read -rp "$(echo -e "${YELLOW}$message${NC} [y/N]: ")" response
  [[ "$response" =~ ^[Yy]$ ]]
}

append_log() {
  local msg="$1"
  mkdir -p "$(dirname "$ROTATION_LOG")"
  echo "$(date -u '+%Y-%m-%dT%H:%M:%SZ') $msg" >> "$ROTATION_LOG"
}

# =============================================================================
# Pre-flight
# =============================================================================
log_section "Pre-flight"

if [[ ! -f "$ENV_FILE" ]]; then
  log_error "$ENV_FILE not found. Run bootstrap-production.sh first."
  exit 1
fi

if ! command -v openssl &>/dev/null; then
  log_error "openssl is required for key generation. Install it first."
  exit 1
fi

log_info "This script rotates production secrets."
log_warn "Ensure you have a deployment mechanism ready to push new env vars BEFORE confirming each step."
echo ""

if ! confirm "Ready to proceed with secret rotation?"; then
  log_info "Rotation aborted."
  exit 0
fi

# Backup existing env file
cp "$ENV_FILE" "$BACKUP_FILE"
chmod 600 "$BACKUP_FILE"
log_ok "Backup created: $BACKUP_FILE"

# Source current values
# shellcheck disable=SC1090
set -a; source "$ENV_FILE"; set +a

append_log "Rotation session started by $(whoami)"

# =============================================================================
# Step 1: INTEGRATION_TOKEN_KEY (AES-256 encryption key for OAuth tokens)
# =============================================================================
log_section "Step 1: INTEGRATION_TOKEN_KEY rotation"
log_info "This key encrypts stored OAuth access/refresh tokens in the database."
log_warn "Rotating this key requires a migration script to re-encrypt existing tokens."
log_warn "DO NOT rotate unless you have the re-encryption migration ready to run."
log_warn "This script blocks key replacement unless $TOKEN_ROTATION_SCRIPT exists."
echo ""

if confirm "Rotate INTEGRATION_TOKEN_KEY?"; then
  if [[ ! -f "$TOKEN_ROTATION_SCRIPT" ]]; then
    log_error "INTEGRATION_TOKEN_KEY rotation blocked: $TOKEN_ROTATION_SCRIPT is missing."
    log_warn "Create and test the re-encryption tool before generating a replacement key."
    log_warn "Required contract: decrypt every stored IntegrationToken with OLD_INTEGRATION_TOKEN_KEY and re-encrypt with NEW_INTEGRATION_TOKEN_KEY."
    append_log "INTEGRATION_TOKEN_KEY rotation blocked - missing re-encryption tool"
  else
    OLD_KEY="${INTEGRATION_TOKEN_KEY:-}"
    NEW_KEY=$(openssl rand -hex 32)

    log_info "New INTEGRATION_TOKEN_KEY generated (64-character hex)"
    log_warn "Old key preserved only as INTEGRATION_TOKEN_KEY_PREV for the re-encryption window."

    # Update in env file
    if grep -q "^INTEGRATION_TOKEN_KEY=" "$ENV_FILE"; then
      # Preserve old key temporarily as _PREV
      sed -i.bak "s|^INTEGRATION_TOKEN_KEY=.*|INTEGRATION_TOKEN_KEY=\"${NEW_KEY}\"\nINTEGRATION_TOKEN_KEY_PREV=\"${OLD_KEY}\"|" "$ENV_FILE"
    else
      echo "INTEGRATION_TOKEN_KEY=\"${NEW_KEY}\"" >> "$ENV_FILE"
    fi

    log_ok "INTEGRATION_TOKEN_KEY updated in $ENV_FILE"
    log_warn "ACTION REQUIRED:"
    log_warn "  1. Run token re-encryption with $TOKEN_ROTATION_SCRIPT using OLD_INTEGRATION_TOKEN_KEY and NEW_INTEGRATION_TOKEN_KEY from the secret store."
    log_warn "  2. Verify all stored IntegrationToken rows decrypt with the new key."
    log_warn "  3. After successful token re-encryption: remove INTEGRATION_TOKEN_KEY_PREV from $ENV_FILE"
    log_warn "  4. Restart API and worker services"
    append_log "INTEGRATION_TOKEN_KEY rotated"
  fi
else
  log_info "INTEGRATION_TOKEN_KEY rotation skipped"
fi

# =============================================================================
# Step 2: VAPID keys (Web Push)
# =============================================================================
log_section "Step 2: VAPID key rotation"
log_info "VAPID keys are used for Web Push notification subscriptions."
log_warn "Rotating VAPID keys will invalidate all existing push subscriptions."
log_warn "All users will need to re-subscribe to push notifications."
echo ""

if confirm "Rotate VAPID keys? (all push subscriptions will be invalidated)"; then
  if command -v npx &>/dev/null; then
    log_info "Generating new VAPID keypair via web-push CLI..."
    VAPID_OUTPUT=$(npx web-push generate-vapid-keys --json 2>/dev/null || echo "")

    if [[ -n "$VAPID_OUTPUT" ]]; then
      NEW_VAPID_PUBLIC=$(echo "$VAPID_OUTPUT" | node -e "let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>console.log(JSON.parse(d).publicKey))")
      NEW_VAPID_PRIVATE=$(echo "$VAPID_OUTPUT" | node -e "let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>console.log(JSON.parse(d).privateKey))")

      for key in VAPID_PUBLIC_KEY VAPID_PRIVATE_KEY; do
        if grep -q "^${key}=" "$ENV_FILE"; then
          sed -i.bak "s|^${key}=.*||" "$ENV_FILE"
        fi
      done
      echo "VAPID_PUBLIC_KEY=\"${NEW_VAPID_PUBLIC}\"" >> "$ENV_FILE"
      echo "VAPID_PRIVATE_KEY=\"${NEW_VAPID_PRIVATE}\"" >> "$ENV_FILE"

      log_ok "VAPID keys updated"
      log_info "New VAPID_PUBLIC_KEY: ${NEW_VAPID_PUBLIC:0:20}..."
    else
      log_warn "Could not generate VAPID keys automatically — generate manually:"
      log_warn "  npx web-push generate-vapid-keys"
      log_warn "  Then update VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY in $ENV_FILE"
    fi
  else
    log_warn "npx not available — generate VAPID keys manually:"
    log_warn "  npx web-push generate-vapid-keys"
    log_warn "  Then update VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY in $ENV_FILE"
  fi

  append_log "VAPID keys rotated — all push subscriptions invalidated"
  log_warn "ACTION REQUIRED: Run DB cleanup to remove stale push subscriptions:"
  log_warn "  DELETE FROM push_subscriptions; (or via pnpm script if available)"
else
  log_info "VAPID key rotation skipped"
fi

# =============================================================================
# Step 3: Stripe webhook secret
# =============================================================================
log_section "Step 3: Stripe webhook secret rotation"
log_info "Stripe webhook secrets are rotated by creating a new webhook endpoint,"
log_info "then deleting the old one after the new secret is deployed."
echo ""

if confirm "Rotate Stripe webhook secret?"; then
  log_warn "MANUAL STEPS REQUIRED (Stripe does not support programmatic webhook rotation without CLI):"
  echo ""
  echo "  1. Go to: https://dashboard.stripe.com/webhooks"
  echo "  2. Click: 'Add endpoint'"
  echo "  3. URL: https://app.bidstack.com/api/webhooks/stripe"
  echo "  4. Subscribe to the same events as the old endpoint (see pentest-rfp.md or Stripe dashboard)"
  echo "  5. Click 'Add endpoint' — a new signing secret (whsec_...) will be shown ONCE"
  echo "  6. Copy the new signing secret"
  echo ""
  read -rsp "  Paste the new STRIPE_WEBHOOK_SECRET (whsec_...): " NEW_STRIPE_SECRET
  echo ""

  if [[ "$NEW_STRIPE_SECRET" =~ ^whsec_ ]]; then
    if grep -q "^STRIPE_WEBHOOK_SECRET=" "$ENV_FILE"; then
      sed -i.bak "s|^STRIPE_WEBHOOK_SECRET=.*|STRIPE_WEBHOOK_SECRET=\"${NEW_STRIPE_SECRET}\"
# STRIPE_WEBHOOK_SECRET_PREV=\"${STRIPE_WEBHOOK_SECRET:-}\" — delete after 1 hour|" "$ENV_FILE"
    else
      echo "STRIPE_WEBHOOK_SECRET=\"${NEW_STRIPE_SECRET}\"" >> "$ENV_FILE"
    fi

    log_ok "STRIPE_WEBHOOK_SECRET updated"
    log_warn "ACTION REQUIRED:"
    log_warn "  1. Deploy the new $ENV_FILE (new secret active after restart)"
    log_warn "  2. Verify in Stripe Dashboard → Webhooks → [new endpoint] → Send test webhook → confirm 200"
    log_warn "  3. After 1 hour: delete the OLD Stripe webhook endpoint from the dashboard"
    append_log "STRIPE_WEBHOOK_SECRET rotated — old endpoint still active during overlap"
  else
    log_error "Invalid format — expected whsec_... — no change made"
  fi
else
  log_info "Stripe webhook secret rotation skipped"
fi

# =============================================================================
# Step 4: JWT signing key (with 1-hour overlap)
# =============================================================================
log_section "Step 4: JWT signing key rotation (with graceful overlap)"
log_info "A new RS256 key pair will be generated."
log_info "The old public key is preserved as JWT_SIGNING_KEY_PREV for 1 hour."
log_info "The API must validate tokens signed by EITHER key during the overlap window."
log_warn "Ensure your JWT verification code supports JWT_SIGNING_KEY_PREV. See docs/solutions/jwt-key-rotation.md"
echo ""

if confirm "Rotate JWT signing key?"; then
  TMPDIR_KEYS=$(mktemp -d)
  trap 'rm -rf "$TMPDIR_KEYS"' EXIT

  log_info "Generating RS256 key pair (4096-bit RSA)..."
  openssl genrsa -out "$TMPDIR_KEYS/private.pem" 4096 2>/dev/null
  openssl rsa -in "$TMPDIR_KEYS/private.pem" -pubout -out "$TMPDIR_KEYS/public.pem" 2>/dev/null

  NEW_PRIVATE_KEY=$(awk 'NF {sub(/\r/, ""); printf "%s\\n",$0;}' "$TMPDIR_KEYS/private.pem")
  NEW_PUBLIC_KEY=$(awk 'NF {sub(/\r/, ""); printf "%s\\n",$0;}' "$TMPDIR_KEYS/public.pem")

  # Preserve old keys as _PREV
  OLD_PRIVATE="${JWT_SIGNING_PRIVATE_KEY:-}"
  OLD_PUBLIC="${JWT_SIGNING_PUBLIC_KEY:-}"

  # Update env file — remove old entries and add new + prev
  for key in JWT_SIGNING_PRIVATE_KEY JWT_SIGNING_PUBLIC_KEY JWT_SIGNING_PRIVATE_KEY_PREV JWT_SIGNING_PUBLIC_KEY_PREV; do
    sed -i.bak "/^${key}=/d" "$ENV_FILE"
  done

  {
    echo "JWT_SIGNING_PRIVATE_KEY=\"${NEW_PRIVATE_KEY}\""
    echo "JWT_SIGNING_PUBLIC_KEY=\"${NEW_PUBLIC_KEY}\""
    echo "# PREV keys valid for 1 hour — remove after overlap window"
    echo "JWT_SIGNING_PRIVATE_KEY_PREV=\"${OLD_PRIVATE}\""
    echo "JWT_SIGNING_PUBLIC_KEY_PREV=\"${OLD_PUBLIC}\""
    echo "JWT_KEY_ROTATION_AT=\"$(date -u '+%Y-%m-%dT%H:%M:%SZ')\""
  } >> "$ENV_FILE"

  rm -rf "$TMPDIR_KEYS"

  log_ok "JWT signing keys rotated with 1-hour overlap preserved"
  log_warn "ACTION REQUIRED:"
  log_warn "  1. Deploy new $ENV_FILE immediately"
  log_warn "  2. Set a 1-hour reminder to remove JWT_SIGNING_*_PREV from $ENV_FILE"
  log_warn "  3. After 1 hour: re-run this step or manually edit $ENV_FILE to remove PREV keys"
  append_log "JWT_SIGNING_KEY rotated — PREV keys active until $(date -u -d '+1 hour' '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || date -u '+%Y-%m-%dT%H:%M:%SZ')"
else
  log_info "JWT signing key rotation skipped"
fi

# =============================================================================
# Summary
# =============================================================================
log_section "Rotation complete"

log_ok "Rotation session complete. Backup: $BACKUP_FILE"
append_log "Rotation session complete"

echo ""
echo -e "  ${BOLD}Post-rotation checklist:${NC}"
echo "  [ ] Deploy updated $ENV_FILE to all production instances"
echo "  [ ] Restart API service (picks up new env vars)"
echo "  [ ] Restart Worker service"
echo "  [ ] Verify: curl https://app.bidstack.com/api/health"
echo "  [ ] Verify: send a test Stripe webhook → confirm 200 in Stripe dashboard"
echo "  [ ] Log in via SSO → confirm JWT still valid"
echo "  [ ] After 1 hour: remove JWT_SIGNING_*_PREV from $ENV_FILE"
echo "  [ ] If INTEGRATION_TOKEN_KEY was rotated: remove INTEGRATION_TOKEN_KEY_PREV only after token re-encryption succeeds"
echo "  [ ] Delete old Stripe webhook endpoint from dashboard"
echo "  [ ] Update rotation log in $ROTATION_LOG"
echo "  [ ] Destroy backup: rm $BACKUP_FILE (after confirming everything works)"
echo ""
echo -e "  ${RED}${BOLD}IMPORTANT: Delete the backup file once the rotation is verified.${NC}"
echo "  It contains the old secrets in plaintext."
