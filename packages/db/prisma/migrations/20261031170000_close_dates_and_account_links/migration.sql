-- Close dates and account links for past projects and contracts.
-- 1) opportunities.closed_at, kept honest by a trigger for every writer.
-- 2) company_id on contract_agreements / project_references, resolved from account_key.
-- All backfills only link when exactly one company in the org matches.

-- AlterTable
ALTER TABLE "opportunities" ADD COLUMN "closed_at" TIMESTAMPTZ(6);
ALTER TABLE "contract_agreements" ADD COLUMN "company_id" UUID;
ALTER TABLE "project_references" ADD COLUMN "company_id" UUID;

-- CreateIndex
CREATE INDEX "opps_org_closed_at_idx" ON "opportunities"("org_id", "closed_at");
CREATE INDEX "contract_agreements_org_company_idx" ON "contract_agreements"("org_id", "company_id");
CREATE INDEX "project_references_org_company_idx" ON "project_references"("org_id", "company_id");

-- AddForeignKey
ALTER TABLE "contract_agreements" ADD CONSTRAINT "contract_agreements_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "project_references" ADD CONSTRAINT "project_references_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill closed_at: the due date when it is not after the last update (a
-- closed deal cannot close in the future), otherwise the last update.
UPDATE "opportunities"
SET "closed_at" = CASE
    WHEN "due_date" IS NOT NULL AND "due_date" <= ("updated_at" AT TIME ZONE 'UTC')::date
      THEN ("due_date"::timestamp AT TIME ZONE 'UTC')
    ELSE "updated_at"
  END
WHERE "stage" IN ('closed_won', 'closed_lost') AND "closed_at" IS NULL;

-- Trigger: entering a closed stage stamps now() (unless the writer set it),
-- leaving one clears it. Covers create, PATCH, transitions and imports.
CREATE OR REPLACE FUNCTION opportunities_closed_at() RETURNS trigger AS $$
BEGIN
  IF NEW."stage" IN ('closed_won', 'closed_lost') THEN
    IF TG_OP = 'INSERT' THEN
      NEW."closed_at" := COALESCE(NEW."closed_at", now());
    ELSIF OLD."stage" NOT IN ('closed_won', 'closed_lost') THEN
      NEW."closed_at" := CASE WHEN NEW."closed_at" IS DISTINCT FROM OLD."closed_at" AND NEW."closed_at" IS NOT NULL
                              THEN NEW."closed_at" ELSE now() END;
    ELSIF NEW."closed_at" IS NULL THEN
      NEW."closed_at" := COALESCE(OLD."closed_at", now());
    END IF;
  ELSE
    NEW."closed_at" := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "opportunities_closed_at_trg"
BEFORE INSERT OR UPDATE OF "stage", "closed_at" ON "opportunities"
FOR EACH ROW EXECUTE FUNCTION opportunities_closed_at();

-- Backfill opportunities.company_id from the customer name (exact,
-- case-insensitive), only where unambiguous.
UPDATE "opportunities" o
SET "company_id" = m.id
FROM (
  SELECT o2.id AS opp_id, MIN(c.id::text)::uuid AS id
  FROM "opportunities" o2
  JOIN "companies" c ON c.org_id = o2.org_id AND c.deleted_at IS NULL
   AND lower(btrim(c.name)) = lower(btrim(o2.customer))
  WHERE o2.company_id IS NULL
  GROUP BY o2.id
  HAVING COUNT(*) = 1
) m
WHERE o.id = m.opp_id;

-- Backfill company_id for contracts and project references: account_key may be
-- a company id, a name, or a slug (see apps/api/src/lib/account-access.ts).
UPDATE "contract_agreements" t
SET "company_id" = m.id
FROM (
  SELECT t2.id AS row_id, MIN(c.id::text)::uuid AS id
  FROM "contract_agreements" t2
  JOIN "companies" c ON c.org_id = t2.org_id AND c.deleted_at IS NULL AND (
       c.id::text = t2.account_key
    OR lower(btrim(c.name)) = lower(btrim(t2.account_key))
    OR btrim(regexp_replace(lower(c.name), '[^a-z0-9]+', '-', 'g'), '-') = lower(btrim(t2.account_key)))
  WHERE t2.company_id IS NULL
  GROUP BY t2.id
  HAVING COUNT(DISTINCT c.id) = 1
) m
WHERE t.id = m.row_id;

UPDATE "project_references" t
SET "company_id" = m.id
FROM (
  SELECT t2.id AS row_id, MIN(c.id::text)::uuid AS id
  FROM "project_references" t2
  JOIN "companies" c ON c.org_id = t2.org_id AND c.deleted_at IS NULL AND (
       c.id::text = t2.account_key
    OR lower(btrim(c.name)) = lower(btrim(t2.account_key))
    OR btrim(regexp_replace(lower(c.name), '[^a-z0-9]+', '-', 'g'), '-') = lower(btrim(t2.account_key)))
  WHERE t2.company_id IS NULL
  GROUP BY t2.id
  HAVING COUNT(DISTINCT c.id) = 1
) m
WHERE t.id = m.row_id;
