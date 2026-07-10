-- Deterministic keyed lookup hash for webhook signing secrets.
-- The secret column is encrypted with random-IV AES-GCM, so inbound receivers
-- cannot safely resolve tenants by plaintext equality once at-rest encryption
-- is enforced. Backfill values with scripts/encrypt-webhook-secrets.ts.
ALTER TABLE "webhook_subscriptions" ADD COLUMN "secret_hash" VARCHAR(64);

CREATE INDEX "webhook_subs_secret_hash_active_idx"
  ON "webhook_subscriptions" ("secret_hash", "active", "deleted_at", "created_at" DESC);
