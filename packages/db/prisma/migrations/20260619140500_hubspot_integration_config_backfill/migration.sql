-- Move legacy HubSpot migration credentials out of the Salesforce integration
-- type. If an org already has a proper HubSpot row, keep that canonical row and
-- retire the old Salesforce-typed duplicate instead of violating the
-- (org_id, type, name) unique constraint.
UPDATE "integration_configs" legacy
SET
    "is_active" = false,
    "deleted_at" = COALESCE(legacy."deleted_at", CURRENT_TIMESTAMP),
    "updated_at" = CURRENT_TIMESTAMP
WHERE legacy."type" = 'salesforce'::"integration_type"
  AND legacy."name" = 'hubspot-migration'
  AND COALESCE(legacy."config"->>'provider', '') = 'hubspot'
  AND EXISTS (
      SELECT 1
      FROM "integration_configs" canonical
      WHERE canonical."org_id" = legacy."org_id"
        AND canonical."type" = 'hubspot'::"integration_type"
        AND canonical."name" = legacy."name"
        AND canonical."deleted_at" IS NULL
  );

UPDATE "integration_configs" legacy
SET
    "type" = 'hubspot'::"integration_type",
    "updated_at" = CURRENT_TIMESTAMP
WHERE legacy."type" = 'salesforce'::"integration_type"
  AND legacy."name" = 'hubspot-migration'
  AND COALESCE(legacy."config"->>'provider', '') = 'hubspot'
  AND NOT EXISTS (
      SELECT 1
      FROM "integration_configs" canonical
      WHERE canonical."org_id" = legacy."org_id"
        AND canonical."type" = 'hubspot'::"integration_type"
        AND canonical."name" = legacy."name"
        AND canonical."id" <> legacy."id"
  );
