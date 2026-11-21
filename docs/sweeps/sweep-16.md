# Sweep 16 — data integrity and multi-tenant isolation

Lens: data can be corrupted, orphaned, silently lost, or read or written across organizations.

Base: `main` at `40b13242ebf18d715b67bb6133a9774bbd7d0c78`.

Synthetic orgs only: Harbor Synthetic Co and Quay Synthetic Ltd. Proofs ran the Fastify API against local Postgres 16 and Redis 7. Each finding has a red commit on current main, then the fix.

Open work that this sweep did not redo: #415, #417, #420, #427, #428, #440, #444, #445, #447, #448, #450, #454, #462, #474, #475, #479, #481, #482, #495, #496, #498, #500, #383, #411, #412.

## Findings

| Severity | Finding | PR | Head | Stack |
| --- | --- | --- | --- | --- |
| HIGH | A deal stores another org's territory id, and the response returns that territory's name | [#508](https://github.com/mysticalsin/bidstack-360/pull/508) | `41ce9476054990141fff323017e5e93ecfc17302` | none |
| HIGH | A note and a meeting import store another org's company id | [#506](https://github.com/mysticalsin/bidstack-360/pull/506) | `ff4c9306dcbc1223d06a61afa07d9e6ff3709ffd` | none |
| HIGH | Soft-deleted tasks stay in deal counts, soft-deleted deals stay in proposal totals, and a deleted company stays as a child's parent | [#507](https://github.com/mysticalsin/bidstack-360/pull/507) | `b6684ad93b9e10c437c02f931dba067644b41710` | none |
| HIGH | A soft-deleted custom field still owns its key (409 on recreate) and its value stays on the company read | [#509](https://github.com/mysticalsin/bidstack-360/pull/509) | `04fab58bc6ed8e515a2a9ea1cbd7eb68699c4282` | none |

### Territory on a deal — #508

`POST` and `PATCH /api/v1/opportunities` copied `territoryId` without an org check. The foreign key is `territories.id`. Harbor's create returned 201 with `territoryName: "Quay Synthetic Region"`. Patch of a deal that had no territory did the same.

Red: `459092825917d1f75c9334c572fbbb7d4b7b2325`.

Green: `pnpm --filter @bidstack/api exec vitest run src/routes/opportunities.territory-owner.integration.test.ts` — 3 passed. A territory in the caller's org still saves.

`#417` also edits `opportunities.ts` (custom-field definitions). The hunks do not overlap. Not stacked.

### Company on a note — #506

`POST /api/v1/notes` and `POST /api/v1/notes/import-meeting` stored `companyId` after `ensureAccountVisible`. That check returns immediately for an unrestricted admin. Harbor's note came back 201 with Quay's company id. `notes.company` has no `onDelete`, so the row can also block a hard delete of Quay's company.

Red: `52caaad66883ee266c8fd61151604cd3232a1fa7`.

Green: `pnpm --filter @bidstack/api exec vitest run src/routes/notes.company-owner.integration.test.ts` — 3 passed.

### Soft-delete leaks — #507

The soft-delete middleware only injects `deletedAt: null` on the top-level `where`.

- Opportunity list `_count.tasks` counted a tombstoned task (`taskCount` 2 with one live task).
- Proposal admin analytics summed `value_micros` with no `o.deleted_at IS NULL`. After the deal was soft-deleted the total did not drop (delta `0` instead of `5000000000` micros).
- Company detail included `parent` with no deleted filter, and company delete left `parentId` set. The child body still contained `Harbor Parent Synthetic`.

Red: `d56cc9cec918172248255fad222f5c7b20f20b93`.

Green: `pnpm --filter @bidstack/api exec vitest run src/routes/soft-delete-leaks.integration.test.ts` — 3 passed. A live parent is still returned.

`#420` filters tasks and files on the deal *detail* include. `#428` is the buying-committee contact. `#495` locks parent-cycle races in the company patch. This branch does not edit those lines.

### Custom field key — #509

`@@unique([orgId, entityType, fieldKey])` includes tombstones. Delete only set `deletedAt`, so the next create of the same key was 409. Value reads included the definition with no `deletedAt` filter, so `keep-me` stayed on the company.

Red: `6b9a2e1916686531d76759acdbd192cb30469b10`.

Green: `pnpm --filter @bidstack/api exec vitest run src/routes/custom-fields.key-reuse.integration.test.ts` — 2 passed. The tombstone is renamed to `deleted:<id>` (not revived), so old values stay on the old id and are hidden on read.

`#415` adds org checks in the same values handlers, on different lines. Not stacked.

## Checked and fine

- All 146 Prisma migrations applied from an empty Postgres 16 database (`prisma migrate deploy`).
- Buying-committee link `POST /api/v1/opportunities/:id/contacts` loads the contact with `{ id, orgId, deletedAt: null }` before insert.
- File upload and finalize reject a `companyId` outside the org (`tenantEntityBelongsToOrg`).
- Proposal create rejects an `opportunityId` outside the org (existing test, 404).
- Task create rejects an `oppId` outside the org, and resolves `assignee` by email inside the org.
- `PATCH /api/v1/companies/:id/tier` rejects a `keyAccountOwnerId` that is not a user in the org.
- Search queries in `apps/api/src/routes/search.ts` include `deletedAt` / `deleted_at IS NULL`.
- `apps/api/src/security/tenant-isolation-sweep.integration.test.ts` already probes GET/PATCH/PUT/DELETE and lists for companies, contacts, leads, tasks, and opportunities.
- Opportunity import assigns territory from the caller's country map. It does not take a client territory id.
- Opportunity create stores money with `unitsToMicros` (whole/fraction `BigInt`), not `Math.round(n * 1e6)`.

## Left unfixed

- `apps/api/src/services/reports/funnel.service.ts` computes weighted pipeline as `value_micros::float8 / 1000000`. Integer micros are exact in float64 up to `2^53` (about $9.0e9). Larger books lose micros. Not given a failing API test in this sweep.
- `Activity.idempotencyKey` is `@unique` in `schema.prisma`. Migration `20260604000300_activity_idempotency_org_scope` installed a unique on `(org_id, idempotency_key)` instead. `prisma migrate diff --from-migrations --to-schema-datamodel` reports that swap, plus many index renames, `gen_random_uuid()` defaults, and extension entries (`citext`, `pg_trgm`, `pgcrypto`) that the datamodel does not mirror. The database from `migrate deploy` is the org-scoped unique, which is the safer constraint. `db push` from the schema would undo it. Not changed here. `#454` already covers retry-safe migration SQL.
- `POST` company update in `companies.ts` commits the company row, then writes `auditLog` in a second call. A failed audit leaves a committed update with no row. `#495` rewrites that handler for the parent-cycle lock, so this sweep did not edit it. Company *delete* in #507 writes the audit row in the same transaction as the tombstone.
- Soft-deleting a company does not clear `opportunities.company_id`. The opportunity detail payload does not include the company relation, so this pass did not show the deleted company name on the deal. Rollups that join `company_id` without `deleted_at` can still attribute value. Left as-is.
- SMS and email sends persist `entityType` / `entityId` with no org check, but only after the provider accepts the message. Not reproduced without Twilio or mail credentials.
- `actorId` on `POST /api/v1/activities` is taken from the body. `ownerId` is checked. Not reproduced as a read of the other org's user record.
- Webhook fan-out on create runs after the transaction and is fail-open. A committed row can exist without an outbox row if recording throws. Treated as the existing fail-open contract, not a new bug.
- Deal detail still includes soft-deleted tasks and documents (#420). A soft-deleted buying-committee contact is still returned (#428). Custom-field definition and entity ownership on the values API, opportunity patch, and task patch are #415, #417, and #427.
