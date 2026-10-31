-- Org chart permissions. Requested by Tony Walteur on 2026-10-31 (18:57 BRT):
-- an org chart per account, modifiable by admins.
--
--   orgchart:read  follows companies:read on every role (system and custom).
--   orgchart:write goes to system Admin roles only.
--
-- Data migration only, no schema change. Idempotent. Grants an org admin
-- explicitly revoked (soft-deleted role_permissions rows) are respected:
-- ON CONFLICT DO NOTHING never revives them.
INSERT INTO "permissions" ("id", "key", "name", "description") VALUES
  (gen_random_uuid(), 'orgchart:read', 'Read org charts', 'View account org charts, node details with meeting intel, and the coverage overlay.'),
  (gen_random_uuid(), 'orgchart:write', 'Edit org charts', 'Add, edit, move and remove org chart nodes, set the root, import CSV and run auto-seed.')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "org_id")
SELECT rp."role_id", oc."id", rp."org_id"
FROM "role_permissions" rp
JOIN "permissions" k ON k."id" = rp."permission_id" AND k."key" = 'companies:read'
JOIN "permissions" oc ON oc."key" = 'orgchart:read'
JOIN "roles" r ON r."id" = rp."role_id" AND r."deleted_at" IS NULL
WHERE rp."deleted_at" IS NULL
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "org_id")
SELECT r."id", p."id", r."org_id"
FROM "roles" r
JOIN "permissions" p ON p."key" = 'orgchart:write'
WHERE r."name" = 'Admin'
  AND r."is_system" = true
  AND r."deleted_at" IS NULL
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
