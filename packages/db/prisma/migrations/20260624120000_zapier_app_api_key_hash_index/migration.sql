-- Audit backlog #26: index the Zapier API-key-hash auth lookup.
-- zapier.ts does findFirst({ where: { apiKeyHash, deletedAt: null } }) on every
-- Zapier request; without this index it sequential-scans zapier_apps.
CREATE INDEX "zapier_apps_api_key_hash_idx" ON "zapier_apps"("api_key_hash");
