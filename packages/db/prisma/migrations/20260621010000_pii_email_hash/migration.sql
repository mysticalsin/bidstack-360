-- Searchable email hash for the PII field-encryption middleware
-- (PII_FIELD_ENCRYPTION=true). Without these columns, enabling the flag broke
-- every Contact/Lead write. HMAC-SHA256 hex = 64 chars.
ALTER TABLE "contacts" ADD COLUMN "email_hash" VARCHAR(64);
ALTER TABLE "leads" ADD COLUMN "email_hash" VARCHAR(64);

CREATE INDEX "contacts_org_email_hash_idx" ON "contacts" ("org_id", "email_hash");
CREATE INDEX "leads_org_email_hash_idx" ON "leads" ("org_id", "email_hash");
