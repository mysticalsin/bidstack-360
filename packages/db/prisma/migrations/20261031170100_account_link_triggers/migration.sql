-- Keep contract_agreements / project_references.company_id linked for new and
-- edited rows, using the same unambiguous account_key match as the backfill.
-- A writer that sets company_id explicitly wins.

CREATE OR REPLACE FUNCTION resolve_account_company_id() RETURNS trigger AS $$
DECLARE
  matched uuid[];
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."account_key" IS NOT DISTINCT FROM OLD."account_key"
     AND NEW."company_id" IS NOT DISTINCT FROM OLD."company_id" THEN
    RETURN NEW;
  END IF;
  IF NEW."company_id" IS NOT NULL AND (TG_OP = 'INSERT' OR NEW."company_id" IS DISTINCT FROM OLD."company_id") THEN
    RETURN NEW;
  END IF;
  SELECT array_agg(DISTINCT c.id) INTO matched
  FROM "companies" c
  WHERE c.org_id = NEW."org_id" AND c.deleted_at IS NULL AND (
       c.id::text = NEW."account_key"
    OR lower(btrim(c.name)) = lower(btrim(NEW."account_key"))
    OR btrim(regexp_replace(lower(c.name), '[^a-z0-9]+', '-', 'g'), '-') = lower(btrim(NEW."account_key")));
  NEW."company_id" := CASE WHEN array_length(matched, 1) = 1 THEN matched[1] ELSE NULL END;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "contract_agreements_company_id_trg"
BEFORE INSERT OR UPDATE OF "account_key", "company_id" ON "contract_agreements"
FOR EACH ROW EXECUTE FUNCTION resolve_account_company_id();

CREATE TRIGGER "project_references_company_id_trg"
BEFORE INSERT OR UPDATE OF "account_key", "company_id" ON "project_references"
FOR EACH ROW EXECUTE FUNCTION resolve_account_company_id();
