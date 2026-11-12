-- One active CSV or Salesforce CSV import per tenant. A second PENDING or
-- RUNNING row for that pair is a unique violation, which the start route
-- returns as 409. HubSpot writes one RUNNING row per entity under a single
-- source, so those rows are outside this index. COMPLETE, FAILED, and
-- CANCELLED free the slot.

CREATE UNIQUE INDEX "migration_jobs_one_active_per_org_source"
ON "migration_jobs" ("org_id", "source")
WHERE "status" IN ('PENDING', 'RUNNING')
  AND "source" IN ('CSV', 'SALESFORCE_CSV');
