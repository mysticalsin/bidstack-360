-- Email-sync resolves a contact per incoming message by (org_id, email). Without
-- a covering index every lookup scanned the whole org's contacts in memory.
-- (Review finding 2026-06-04.) email is Citext, so this index is case-insensitive.
CREATE INDEX IF NOT EXISTS "contacts_org_email_idx" ON "contacts"("org_id", "email");
