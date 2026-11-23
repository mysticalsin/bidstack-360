# Soft-delete relation reads and unique-key reuse

## Problem

The Prisma soft-delete middleware only injects `deletedAt: null` on the
top-level `where` of `findMany`, `count`, `update`, and `upsert`. It does not
see nested relation filters or `_count` selects. A list badge, a to-one
parent include, and a custom-field value read can therefore still surface a
tombstone.

`CustomFieldDefinition` also has `@@unique([orgId, entityType, fieldKey])`.
That unique includes soft-deleted rows, so deleting a field and creating the
same key again is a 409.

## Pattern

- On a nested read, pass `where: { deletedAt: null }` (counts and to-many)
  or drop a to-one parent in the handler when `parent.deletedAt` is set.
- When a soft-deleted row occupies a business unique key, rename the
  tombstone (`deleted:<id>`) in the same update that sets `deletedAt`.
  Leave the values on the old definition id and exclude them with
  `definition: { deletedAt: null }`.
- Clear live children's `parentId` in the same transaction as the parent
  tombstone. The database `ON DELETE SET NULL` only runs for a hard delete.

## Verification

`apps/api/src/routes/tenant-integrity.integration.test.ts` covers a foreign
territory, a foreign note company, custom-field key reuse, a deleted parent,
and a tombstoned task count.
