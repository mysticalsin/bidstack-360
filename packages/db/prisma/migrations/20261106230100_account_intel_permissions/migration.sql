-- Account intelligence permissions (slice 12).
--
--   account-intel:read  follows companies:read on every role (system and custom).
--   account-intel:write goes to the system Admin, Manager, Sales, Sales Manager
--   and Account Executive roles, matching seed.rbac.ts.
--
-- Data migration only, no schema change. Idempotent. Grants an org admin
-- explicitly revoked (soft-deleted role_permissions rows) are respected:
-- ON CONFLICT DO NOTHING never revives them.
INSERT INTO "permissions" ("id", "key", "name", "description") VALUES
  (gen_random_uuid(), 'account-intel:read', 'Read account intelligence', 'View hiring, company posts, financials, investment themes and direction for an account.'),
  (gen_random_uuid(), 'account-intel:write', 'Refresh account intelligence', 'Queue a refresh of job boards, company posts, registries or filings for an account.')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "org_id")
SELECT rp."role_id", ai."id", rp."org_id"
FROM "role_permissions" rp
JOIN "permissions" k ON k."id" = rp."permission_id" AND k."key" = 'companies:read'
JOIN "permissions" ai ON ai."key" = 'account-intel:read'
JOIN "roles" r ON r."id" = rp."role_id" AND r."deleted_at" IS NULL
WHERE rp."deleted_at" IS NULL
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "org_id")
SELECT r."id", p."id", r."org_id"
FROM "roles" r
JOIN "permissions" p ON p."key" = 'account-intel:write'
WHERE r."name" IN ('Admin', 'Manager', 'Sales', 'Sales Manager', 'Account Executive')
  AND r."is_system" = true
  AND r."deleted_at" IS NULL
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
