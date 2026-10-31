-- Presales creates MSAs and uploads new versions. Approved by Tony Walteur
-- on 2026-10-31 (18:05 BRT).
--
-- Data migration only, no schema change. Idempotent. System 'Presales' roles
-- only; custom roles keep what 20261031200000_msa_library derived from
-- accounts:write. Grants an org admin explicitly revoked (soft-deleted
-- role_permissions rows) are respected: ON CONFLICT DO NOTHING never revives
-- them. msa:admin (archive, edit someone else's agreement) is not granted.
INSERT INTO "role_permissions" ("role_id", "permission_id", "org_id")
SELECT r."id", p."id", r."org_id"
FROM "roles" r
JOIN "permissions" p ON p."key" = 'msa:write'
WHERE r."name" = 'Presales'
  AND r."is_system" = true
  AND r."deleted_at" IS NULL
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
