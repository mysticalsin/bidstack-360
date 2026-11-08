-- schema.prisma has declared contacts_org_created_idx since P1 #25, but no
-- migration ever built it. GET /api/v1/contacts orders by created_at DESC
-- within the org, so every page sorted the whole org's contacts.

CREATE INDEX IF NOT EXISTS contacts_org_created_idx ON contacts (org_id, created_at DESC);
