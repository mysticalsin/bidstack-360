-- RFP-CREW-002 — stable identity for the standard RFP crew.
-- Without this, the seed matched the crew by name ('RFP Response Crew'), so a
-- user-created crew with the same name collided with the seed workflow. crews now
-- carry a stable standard_key; the seed matches/refreshes by key.

ALTER TABLE "crews" ADD COLUMN IF NOT EXISTS "standard_key" VARCHAR(100);

-- Backfill: adopt the EARLIEST existing name-seeded standard crew per org into the
-- stable key (earliest-only so the partial unique index below can never conflict
-- even if an org already has two crews named 'RFP Response Crew').
UPDATE "crews" c
SET "standard_key" = 'rfp_response_crew'
WHERE c."id" = (
  SELECT c2."id" FROM "crews" c2
  WHERE c2."org_id" = c."org_id"
    AND c2."name" = 'RFP Response Crew'
    AND c2."deleted_at" IS NULL
  ORDER BY c2."created_at" ASC
  LIMIT 1
)
  AND c."name" = 'RFP Response Crew'
  AND c."deleted_at" IS NULL
  AND c."standard_key" IS NULL;

-- One ACTIVE standard crew per key per org. Partial (active + non-null key) so
-- user crews (NULL key) are unconstrained and a soft-deleted standard crew can be
-- reseeded. Mirrors the crew_agents_org_key_key pattern.
CREATE UNIQUE INDEX IF NOT EXISTS "crews_org_standard_key_key"
  ON "crews"("org_id", "standard_key")
  WHERE "deleted_at" IS NULL AND "standard_key" IS NOT NULL;
