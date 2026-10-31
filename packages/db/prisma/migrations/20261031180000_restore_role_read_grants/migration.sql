-- Restore read access that the secure-by-default read gates (#28, commit
-- f9249f14) removed from three seeded system roles. Approved by Tony
-- Walteur on 2026-10-31.
--
--   SDR                -> opportunities:read, proposals:read, reports:read
--   Customer Success   -> leads:read
--   Account Executive  -> documents:read, territories:read, migrations:read
--
-- Data migration only, no schema change. Idempotent. Write permissions are
-- untouched. Grants an org admin has explicitly revoked (soft-deleted
-- role_permissions rows) are respected: ON CONFLICT DO NOTHING never revives
-- them.

-- 1. New, narrow permission for the data-import read routes, which were
--    gated by settings:read. AE needs migrations, not every settings read.
INSERT INTO "permissions" ("id", "key", "name", "description")
VALUES (
  gen_random_uuid(),
  'migrations:read',
  'Read data migrations',
  'View data import jobs, field mappings and failed-row reports. Running or undoing an import needs settings:write.'
)
ON CONFLICT ("key") DO NOTHING;

-- 2. Nobody loses access: every role that can read settings today keeps
--    reading migrations under the new key.
INSERT INTO "role_permissions" ("role_id", "permission_id", "org_id")
SELECT rp."role_id", mig."id", rp."org_id"
FROM "role_permissions" rp
JOIN "permissions" sr ON sr."id" = rp."permission_id" AND sr."key" = 'settings:read'
CROSS JOIN "permissions" mig
WHERE mig."key" = 'migrations:read'
  AND rp."deleted_at" IS NULL
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

-- 3. The approved grants, on live system roles only (custom roles untouched).
INSERT INTO "role_permissions" ("role_id", "permission_id", "org_id")
SELECT r."id", p."id", r."org_id"
FROM "roles" r
JOIN (
  VALUES
    ('SDR', 'opportunities:read'),
    ('SDR', 'proposals:read'),
    ('SDR', 'reports:read'),
    ('Customer Success', 'leads:read'),
    ('Account Executive', 'documents:read'),
    ('Account Executive', 'territories:read'),
    ('Account Executive', 'migrations:read')
) AS g ("role_name", "permission_key") ON g."role_name" = r."name"
JOIN "permissions" p ON p."key" = g."permission_key"
WHERE r."is_system" = true
  AND r."deleted_at" IS NULL
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
