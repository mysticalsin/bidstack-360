# Operations Runbook — BidStack 360°

> Owner: Platform Engineering. Last updated: 2026-05-24.

This runbook covers day-to-day operational procedures. For architecture details see `docs/ARCHITECTURE.md`. For security incidents see `docs/security/`.

---

## Table of Contents

1. [Deploy](#deploy)
2. [Rollback](#rollback)
3. [Scale](#scale)
4. [Restore from backup](#restore-from-backup)
5. [Rotate INTEGRATION_TOKEN_KEY](#rotate-integration_token_key)
6. [Rotate VAPID keys](#rotate-vapid-keys)
7. [Enable PII encryption](#enable-pii-encryption)
8. [Troubleshoot integrations](#troubleshoot-integrations)
9. [Common errors](#common-errors)

---

## Deploy

### Standard deploy (Docker / container)

`docker-compose.prod.yml` requires `INTEGRATION_TOKEN_KEY` for both API and
worker because both services decrypt tenant/provider secrets. It also publishes
the web UI on `WEB_HTTP_PORT` (default `8080`) to the web container's
unprivileged nginx port `8080`. Run the compose policy before building so env
or ingress drift fails before an image is shipped.

```bash
# 0. Validate production compose / env wiring
pnpm deploy:evidence:compose:policy
docker compose -f docker-compose.prod.yml config --quiet

# 1. Build and tag the API image
docker build -t bidstack-api:$GIT_SHA -f Dockerfile .

# 2. Run DB migrations (zero-downtime — Prisma uses forward-compatible migrations)
docker run --rm \
  --env-file .env.production \
  bidstack-api:$GIT_SHA \
  pnpm db:migrate:deploy

# 3. Rolling restart (example: Kubernetes)
kubectl set image deployment/bidstack-api api=bidstack-api:$GIT_SHA
kubectl rollout status deployment/bidstack-api

# 4. Verify health
curl https://api.bidstack.io/health
# Expected: {"ok":true,"db":true,"redis":true}
```

### Local dev start

```bash
pnpm install
pnpm db:migrate
pnpm db:seed
pnpm dev           # starts all services in parallel
```

---

## Rollback

### Application rollback

```bash
# Kubernetes
kubectl rollout undo deployment/bidstack-api
kubectl rollout status deployment/bidstack-api
```

### Database rollback

Prisma does not generate automatic down migrations. For data rollbacks:

1. Identify the migration to undo in `packages/db/prisma/migrations/`.
2. Write a compensating migration (SQL) that reverses the schema change.
3. Apply: `pnpm db:migrate:deploy` after adding the compensating migration.

**Never hand-edit `prisma/migrations/`** — see `CLAUDE.md` constraints.

### PII encryption rollback

See [Enable PII encryption — Rollback](#rollback-1) below.

---

## Scale

### API horizontal scale

The API is stateless (auth via Clerk JWT, no server-side sessions). Add replicas freely.

Redis is the shared state layer:

- Rate limiting: `@fastify/rate-limit` with Redis backend
- Idempotency: `idempotencyPlugin` uses Redis TTL store
- BullMQ queues: processed by `apps/worker` (scale workers independently)

```bash
# Example: scale to 5 API replicas
kubectl scale deployment/bidstack-api --replicas=5
```

### Worker scale

BullMQ workers are horizontally scalable — each pulls jobs independently.

```bash
kubectl scale deployment/bidstack-worker --replicas=3
```

Monitor queue depth:

```bash
# Redis CLI
redis-cli LLEN bull:dust-poll:wait
redis-cli LLEN bull:notifications:wait
```

---

## Restore from backup

### PostgreSQL restore

```bash
# Assumes pg_dump backups to S3 (set up externally)
aws s3 cp s3://bidstack-backups/pg/latest.dump ./latest.dump

# Stop all API + worker instances first to prevent writes during restore
kubectl scale deployment/bidstack-api --replicas=0
kubectl scale deployment/bidstack-worker --replicas=0

# Restore
pg_restore -Fc -d $DATABASE_URL ./latest.dump

# Re-run any migrations that post-date the backup
pnpm db:migrate:deploy

# Restart
kubectl scale deployment/bidstack-api --replicas=3
kubectl scale deployment/bidstack-worker --replicas=2
```

---

## Rotate INTEGRATION_TOKEN_KEY

`INTEGRATION_TOKEN_KEY` encrypts OAuth tokens in `IntegrationToken` table (AES-256-GCM, `token-cipher.ts`).
`scripts/ops/rotate-secrets.sh` intentionally blocks this rotation unless `scripts/rotate-integration-tokens.ts` exists.
The rotation tool is resumable: rows already encrypted with the new key are skipped.

```bash
# 1. Prove the operator contract and local crypto behavior.
pnpm deploy:evidence:secret-rotation:policy
pnpm deploy:evidence:secret-rotation:tool:selftest

# 2. Generate but do not deploy the new key yet.
NEW_KEY=$(openssl rand -hex 32)

# 3. Dry-run database re-encryption with both keys.
OLD_INTEGRATION_TOKEN_KEY=<old> \
NEW_INTEGRATION_TOKEN_KEY="$NEW_KEY" \
pnpm exec tsx scripts/rotate-integration-tokens.ts --dry-run

# 4. Apply re-encryption. If interrupted, rerun the same command; already-new rows are skipped.
OLD_INTEGRATION_TOKEN_KEY=<old> \
NEW_INTEGRATION_TOKEN_KEY="$NEW_KEY" \
pnpm exec tsx scripts/rotate-integration-tokens.ts --apply

# 5. Update INTEGRATION_TOKEN_KEY env to "$NEW_KEY" and redeploy.
# 6. Keep INTEGRATION_TOKEN_KEY_PREV / old key until app/API smoke tests pass.
# 7. Remove INTEGRATION_TOKEN_KEY_PREV only after token re-encryption and smoke tests succeed.
```

If any row cannot decrypt with the old or new key, stop and investigate before
changing the active environment secret.

---

## Rotate VAPID keys

VAPID keys are used for Web Push notifications.

```bash
# 1. Generate new keys
npx web-push generate-vapid-keys

# 2. Update VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VITE_VAPID_PUBLIC_KEY in env

# 3. Redeploy (API uses new keys for new push subscriptions)

# IMPORTANT: existing browser push subscriptions (stored in push_subscriptions table)
# were registered with the OLD public key. They will stop receiving pushes.
# Users must re-subscribe. Either:
#   a. Notify users to refresh the app (subscription auto-renews on next visit), or
#   b. Delete all push_subscriptions rows and let the app re-register.
```

---

## Enable PII encryption

Full runbook in `docs/security/pii-field-encryption.md`. Summary:

```bash
# Pre-check: key must be set
export PII_ENCRYPTION_MASTER_KEY=$(openssl rand -hex 32)
# Store this key in your secret manager — do NOT commit it.

# Step 1: Dry-run migration (PII_FIELD_ENCRYPTION still false)
tsx scripts/encrypt-existing-pii.ts --dry-run

# Step 2: Apply migration
tsx scripts/encrypt-existing-pii.ts

# Step 3: Verify (spot-check a row)
psql $DATABASE_URL -c "SELECT email FROM contacts LIMIT 3;"
# Expect: enc:v1:...
psql $DATABASE_URL -c "SELECT email FROM leads WHERE email IS NOT NULL LIMIT 3;"
psql $DATABASE_URL -c "SELECT email FROM kam_consultants WHERE email IS NOT NULL LIMIT 3;"

# Step 4: Set env and redeploy
PII_FIELD_ENCRYPTION=true
# Rolling restart — middleware activates on first request.

# Step 5: Confirm
curl -H "Authorization: Bearer $TOKEN" https://api.bidstack.io/api/v1/contacts?limit=1
# email field in response should be plaintext (decrypted by middleware)
```

### Rollback

```bash
# Turn off encryption first
PII_FIELD_ENCRYPTION=false
# Redeploy

# Decrypt all rows
PII_ENCRYPTION_MASTER_KEY=<key> tsx scripts/decrypt-pii-rollback.ts
```

---

## Troubleshoot integrations

### Gmail OAuth flow broken

```bash
# Check redirect URI matches Google Cloud Console
echo $GMAIL_REDIRECT_URI
# Must match exactly: http://localhost:4000/api/v1/integrations/gmail/oauth/callback

# Check token storage
psql $DATABASE_URL -c "SELECT id, org_id, provider, created_at FROM integration_tokens WHERE provider='gmail';"

# Test token refresh (if access token expired)
curl -X POST https://api.bidstack.io/api/v1/integrations/gmail/oauth/refresh \
  -H "Authorization: Bearer $TOKEN"
```

### Microsoft Graph webhooks not arriving

1. Check `MICROSOFT_WEBHOOK_BASE_URL` is a public HTTPS URL (Graph rejects `localhost` and self-signed certs).
2. Use ngrok or Cloudflare Tunnel in dev: `ngrok http 4000`.
3. Verify subscription is active:
   ```bash
   psql $DATABASE_URL -c "SELECT id, expiration_date_time FROM graph_subscriptions WHERE org_id='<orgId>';"
   ```
4. Graph subscriptions expire after 4230 minutes (3 days). The worker auto-renews them. Check worker logs for `renewal` log lines.

### Slack events not being received

1. Confirm Slack app Event Subscriptions URL is set to `https://api.bidstack.io/api/v1/integrations/slack/events`.
2. Check URL verification: Slack sends a `url_verification` challenge on first configuration — the route responds automatically.
3. Check request signature: Slack signs requests with `SLACK_SIGNING_SECRET`. Verify the env var is set.

### Zapier trigger not firing

1. Confirm `ZAPIER_WEBHOOK_SECRET` is set and matches the Zapier zap's auth configuration.
2. Check `zapier_triggers` table for the trigger definition.
3. Test manually: `curl -X POST https://api.bidstack.io/webhooks/zapier/<orgId>/<triggerId>` with the expected payload.

---

## Common errors

### `PrismaClientInitializationError: Can't reach database server`

- Check `DATABASE_URL` is correct.
- Verify PostgreSQL is running: `pg_isready -h localhost -p 5433`.
- In dev: `docker-compose up postgres` or `pnpm dev` (starts Docker services).

### `ECONNREFUSED redis:6380`

- Check `REDIS_URL`.
- In dev: `docker-compose up redis`.

### `INTEGRATION_TOKEN_KEY must be a 64-character hex string`

- Set the env var: `INTEGRATION_TOKEN_KEY=$(openssl rand -hex 32)`.
- This blocks startup intentionally — token encryption requires a key.

### `PII_ENCRYPTION_MASTER_KEY must be a 64-character hex string`

- Set `PII_ENCRYPTION_MASTER_KEY` OR set `PII_FIELD_ENCRYPTION=false` to disable encryption.

### BullMQ jobs stuck in `waiting` state

- Worker may be down. Check: `kubectl get pods -l app=bidstack-worker`.
- Redis connection issue. Check worker logs for Redis errors.
- Queue may be paused: `redis-cli OBJECT ENCODING bull:<queue>:meta`.

### Clerk auth returns 401 in production

- Check `CLERK_SECRET_KEY` is the production (live) key, not test key.
- Verify `CLERK_PUBLISHABLE_KEY` on the frontend matches.
- JWT clock skew: ensure server clock is synced (NTP).
