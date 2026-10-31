-- Account Executive reads meeting intel. Approved by Tony Walteur on
-- 2026-10-31 (18:04 BRT).
--
-- Data migration only, no schema change. Idempotent. System roles only
-- (custom roles keep whatever 20261031220000_meeting_intel derived from
-- kam:read). Grants an org admin explicitly revoked (soft-deleted
-- role_permissions rows) are respected: ON CONFLICT DO NOTHING never revives
-- them.
INSERT INTO "role_permissions" ("role_id", "permission_id", "org_id")
SELECT r."id", p."id", r."org_id"
FROM "roles" r
JOIN "permissions" p ON p."key" = 'meetings:read'
WHERE r."name" = 'Account Executive'
  AND r."is_system" = true
  AND r."deleted_at" IS NULL
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
