-- Tenant-scope the edit-lock uniqueness so a lock row cannot be overwritten /
-- taken over across orgs via upsert. Was UNIQUE(entity_type, entity_id).
DROP INDEX "entity_edit_locks_entity_type_entity_id_key";

CREATE UNIQUE INDEX "entity_edit_locks_org_id_entity_type_entity_id_key"
  ON "entity_edit_locks" ("org_id", "entity_type", "entity_id");
