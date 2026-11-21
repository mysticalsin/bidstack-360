# Sweep 07 — API contract and data integrity

Lens: request validation against the shared Zod schemas, response shapes the web client reads, stable pagination and totals, org isolation (a cross-org id is 404), soft-deleted rows hidden, foreign keys and orphans, migration retry, and list queries that are not one round-trip per row.

Date: 2026-11-21. Base: `main` at `40b13242ebf18d715b67bb6133a9774bbd7d0c78`.

Stack: PostgreSQL 16.15 with pgvector 0.6, Redis 7, Node 24.11.1, pnpm 10.27.0, on this VM only. Database `bidstack`, role `bidstack`. No Clerk key, no provider keys, no deploy, no `polo-preview`, no R2. Orgs came from `createIsolatedOrg` (synthetic seed). Stub auth was the Admin of the caller org.

`prisma migrate deploy` applied 146 migrations on an empty database. The second deploy reported no pending migrations.

## Severity

| # | Severity | Finding | Status |
| --- | --- | --- | --- |
| 1 | High | Custom-field values accept another org's entity and skip an unknown definition | Fixed, #415 |
| 2 | High | Opportunity patch stores a custom field owned by another org | Fixed, #417 |
| 3 | High | A task patch that only sets custom fields is 404, and a foreign definition is stored once a scalar is sent | Fixed, #427 |
| 4 | High | Signature list and detail call paths the API does not register, and the list ignores the shared filter | Fixed, #442 |
| 5 | Medium | Deal detail returns soft-deleted tasks and files | Fixed, #420, stacked on #417 |
| 6 | Medium | The buying committee returns a soft-deleted contact | Fixed, #428 |
| 7 | Medium | MSA re-confirm returns another org's company id | Fixed, #440 |
| 8 | Medium | Story matches 400 once a match exists, and the scan stops at 500 requirements | Fixed, #447 |
| 9 | Medium | An activity cursor and an offset are both applied | Fixed, #444 |
| 10 | Medium | Proposal pages are not stable when `updatedAt` ties | Fixed, #445 |
| 11 | Medium | Bid-score pages are not stable when `createdAt` ties | Fixed, #448 |
| 12 | Low | Three migration files are not safe to re-apply | Ratchet only, #454. SQL not rewritten |

## Fixed

### 1. High — custom-field values were not confined to the caller's org

`PATCH /api/v1/custom-fields/values` is the write the custom-field form uses. It skipped a definition id that was not an active field in the caller's org and answered 200. It also stored a value against a company id from another org.

`GET` of that foreign company id returned an empty list, which is the shape of "no values," not "not yours."

The entity must be a live row in the caller's org. Otherwise the read and the write are 404. Every definition id must be an active definition of that org and entity type. Otherwise the write is 400 and nothing is stored.

- PR: https://github.com/mysticalsin/bidstack-360/pull/415
- Head: `e1d0c80c1a79512bdc54a822f6cb0adf477b3c47`
- Red, then green: `apps/api/src/routes/custom-fields.values-ownership.integration.test.ts` (4 passed). Before the fix the three bad calls were 200.

### 2. High — an opportunity patch stored another org's custom field

`PATCH /api/v1/opportunities/:id` upserted `customFieldValues` for any definition id that existed. Contacts, companies, and leads already refuse a definition from outside the org. The value's unique key includes the caller's org. The foreign key does not, so the other org's delete of the field cascade-deletes this value, and a 200 confirms the foreign id exists.

The check runs before the update transaction. A foreign id is 400 and the opportunity is unchanged.

- PR: https://github.com/mysticalsin/bidstack-360/pull/417
- Head: `03872e16f5b378c6915593cc1efbe29a45df9e7e`
- Red, then green: `apps/api/src/routes/opportunities.cf-owner.integration.test.ts` (1 passed). Before the fix the patch was 200.

### 3. High — a custom-field-only task patch said the task was missing

`TaskPatch` allows a body that is only `customFieldValues`. The handler still built a scalar `updateMany`. With no title, due date, status, or assignee, that data object was empty, `updateMany` reported zero rows, and the route answered 404. `GET` of the same id in the same second was 200. The values were never written.

Once a scalar field was also sent, the loop stored any definition id.

A foreign definition is 400 before any write. An empty scalar patch does not call `updateMany` and is not a missing task. A scalar patch that matches zero live rows is still 404.

- PR: https://github.com/mysticalsin/bidstack-360/pull/427
- Head: `b55caa32b086c5f7fc33e1d15d751c5e8a70e168`
- Red, then green: `apps/api/src/routes/tasks.cf-owner.integration.test.ts` (2 passed). Before the fix both the foreign definition and this org's definition, sent alone, were 404.

### 4. High — the signature client and the signature list were different contracts

The inbox and the detail call `/api/signatures` and `/api/signatures/:id`. Path normalization turns those into `/api/v1/signatures`, which is not a route. The API registers `/api/v1/signatures/requests`. Resend posted to `/api/signatures/:id/resend`, which was never registered and which nothing in the app called.

The list that does exist did not use `SignatureRequestFilter` or `SignatureRequestPage`. `dateFrom`, `dateTo`, and `cursor` were stripped. Pages were `skip` on `createdAt` alone. The response had `total` and no `nextCursor`. A recipient stored as `signer` came back as that string. `SignatureRequest` only allows `SIGNER` or `CC`.

The hooks now call `/api/v1/signatures/requests`. The unused resend hook is removed. The list uses the shared filter (`limit` is coerced because a query string is text), bounds `createdAt`, orders by `createdAt` then `id`, and returns `nextCursor`. `total` counts the filtered set. Detail events include `signatureRequestId` and `userAgent`.

- PR: https://github.com/mysticalsin/bidstack-360/pull/442
- Head: `363b130cbd764cc64088c8aa2b88b16cc455ce95`
- Red, then green: `apps/web/src/hooks/useSignatureRequests.test.tsx` (4 passed; before the hook change the list URL was `/api/signatures`). `apps/api/src/routes/signatures.list-contract.integration.test.ts` (3 passed). A 2020 row with role `signer` is excluded by `dateFrom=2026-01-01`. `dateTo=2020-12-31` returns it as `SIGNER`. The other org's id is 404.

### 5. Medium — a deleted task or file came back on the deal

`GET /api/v1/opportunities/:id` includes `tasks` and `documents` with no `deletedAt` filter. The soft-delete middleware only rewrites the top-level `where`. A tombstoned task or file was still in the payload.

Both includes now set `where: { deletedAt: null }`.

This stacks on #417. Both edits are in `opportunities.ts`. The branch starts at that PR's head, so this diff is only the include filter.

- PR: https://github.com/mysticalsin/bidstack-360/pull/420
- Head: `cde440bc4014532102a389ac5f90e0a7f1b2a230`
- Red, then green: `apps/api/src/routes/opportunities.deleted-children.integration.test.ts` (1 passed). Before the fix the deleted task id was in `tasks`.

### 6. Medium — a deleted contact stayed on the buying committee

`GET /api/v1/opportunities/:id/contacts` includes the contact and does not filter `contact.deletedAt`. The nested relation is not covered by the middleware, so the deleted buyer's name and email stayed on the deal.

The list `where` now requires `contact: { deletedAt: null }`.

- PR: https://github.com/mysticalsin/bidstack-360/pull/428
- Head: `4cce9682a210343cdbd9c2401ee0981ac2f4b2b8`
- Red, then green: `apps/api/src/routes/opportunity-contacts.tombstone.integration.test.ts` (1 passed). Before the fix the deleted contact id was in `items`.

### 7. Medium — MSA re-confirm leaked another org's company

`POST /api/v1/msa/intake/:id/confirm` is idempotent once a draft is `confirmed`. That path loaded the agreement by id and returned `companyId`. A draft whose `confirmedContractId` pointed at another org answered 201 with that company id. A missing company fell through to `''`, which cannot satisfy the response schema (`companyId` is a uuid).

The replay loads the agreement with the caller's `orgId` and `deletedAt: null`. A miss, or a row with no company, is 404.

- PR: https://github.com/mysticalsin/bidstack-360/pull/440
- Head: `eca1e8b5d9ff74799fffea3bf5b54f7deab2c1fb`
- Red, then green: `apps/api/src/routes/msa-intake.confirm-org.integration.test.ts` (1 passed). Before the fix the call was 201 and the body contained the other org's company id.

### 8. Medium — story matches failed closed, and the scan stopped at 500

`GET /api/v1/bid-workspaces/:opportunityId/story-matches` loaded 500 requirements with no order and used that id list as the whole RFP. `total` was the number of stories in that sample.

The reference read had no `take`. With the query guard on, any non-empty match set answered 400 `Unbounded queries are not allowed. Models affected: Reference.findMany`.

Matches are now one join to every live requirement on the opportunity. The reference read takes exactly that set. Tied scores sort by id.

- PR: https://github.com/mysticalsin/bidstack-360/pull/447
- Head: `257e0bb93d06082c6b5aa1ff9fa0115a7e630b71`
- Red, then green: `apps/api/src/routes/bid-workspace-rfp.story-scan.integration.test.ts` (1 passed). 501 requirements, one match on the last. Before the fix the call was 400. After the fix, `total` is 1 and the title is Past delivery.

### 9. Medium — an activity cursor and an offset both moved the page

`ActivityFilter` accepts `cursor` and `offset`. The list applied the cursor in the `where` and also `skip: offset`. A non-zero offset on top of a cursor skips twice. `total` still counts the whole filtered set. Omitted offset defaults to 0, so cursor-only clients were fine. The schema still allows both.

`activityListSkip` returns 0 when a cursor is present.

- PR: https://github.com/mysticalsin/bidstack-360/pull/444
- Head: `06094f0ea2d6e203bdefe3bcb81a063b9de8bf46`
- Red, then green: `apps/api/src/services/activity.list-skip.test.ts` (2 passed). Before the fix, a cursor plus offset 20 returned 20.

### 10. Medium — proposal pages had no tie-break

`GET /api/v1/proposals` pages with `offset` and ordered only by `updatedAt`. Two proposals saved in the same millisecond have no defined order.

The list now orders by `updatedAt` descending, then `id` descending.

- PR: https://github.com/mysticalsin/bidstack-360/pull/445
- Head: `74d405f62a70d595dbd2a5022db5b887fb547831`
- Test: `apps/api/src/routes/proposals.list-order.integration.test.ts` (1 passed). Two proposals share `updated_at`. Page size 1. `total` is 2. The pages are the higher id, then the lower id.

### 11. Medium — bid-score pages had no tie-break

`GET /api/v1/bid-scores` pages with `offset` and ordered only by `createdAt`.

The list now orders by `createdAt` descending, then `id` descending.

- PR: https://github.com/mysticalsin/bidstack-360/pull/448
- Head: `ca616f07a03c03de5bb68546f4c58fbbbdf490a0`
- Test: `apps/api/src/routes/bid-scores.list-order.integration.test.ts` (1 passed). Two versions share `created_at`. The pages are the higher id, then the lower id.

### 12. Low — three migration files are not safe to re-apply

A second `migrate deploy` is safe because Prisma skips recorded files. A retry after the DDL commits and the bookkeeping row does not is not. These executable statements lack `IF NOT EXISTS`:

- `20261112170100_migration_jobs_one_active_per_file` — `CREATE UNIQUE INDEX CONCURRENTLY`
- `20260525010000_sync_drift` — `ALTER TYPE ... ADD VALUE`
- `20261031200000_msa_library` — `ALTER TYPE ... ADD VALUE`

Editing them would change the checksum of a migration that has already shipped. They are listed in a test. A new file that repeats the unsafe form fails. The list can shrink when a file is fixed. It is not a place to add a new name.

- PR: https://github.com/mysticalsin/bidstack-360/pull/454
- Head: `093f0342a90ce2779020e9962d134f60606ec05b`
- Test: `packages/db/src/migrations.idempotent.test.ts` (2 passed).

## Covered by an open PR

These were open on `main` before this sweep. They were not edited here.

| Finding on this lens | Open PR |
| --- | --- |
| Filtered opportunity totals were the current page | #378. Supersedes #58. |
| Win/loss totals stopped at 1,000 rows | #386 |
| "Closed this quarter" used UTC edits, not the org quarter | #384 |
| Weighted pipeline rounded in float | #396 |
| The tasks report marked a due-today task overdue | #393 |
| Tasks badge and the Tasks page counted different sets | #375 |
| Deleting an account left its open deals on the pipeline | #394 |
| Account open total dropped a deal outside the latest 500 | #357 |
| Account pipeline presented a deal sample as the book | #59 and #380 |
| A live lost stage still looked open, and a named open stage was missing from the chart | #381 and #382. Supersede #71 and #72. |
| Import start and undo were not gated on `settings:write` | #383 |
| Unreadable spreadsheets | #400 |

## Checked, no new defect

- Core list cursors. `apps/api/src/security/cursor-pagination.integration.test.ts` already walks leads, contacts, companies, tasks, opportunities, and audit logs. Pages are disjoint, complete, and bounded. This sweep did not re-implement that.
- Top-level soft delete. `makeSoftDeleteMiddleware` injects `deletedAt: null` on `findMany`, `findFirst`, and `count` unless the caller already filters `deletedAt`. The holes were nested `include`s, fixed in #420 and #428.
- Cross-org id on the paths exercised here returned 404 and did not echo the other org's fields: custom-field entity (#415), signature detail (#442), MSA re-confirm (#440). The existing tenant-isolation suite still covers companies, contacts, leads, tasks, and opportunities.
- List N+1. The list handlers reviewed batch their reads. The story-match reference read was one unbounded `findMany`, which the query guard rejected. #447 bounds it. No list was found that queries once per row.
- Opportunity timeline. Each source is capped at `limit + 1`, then merged. The global top `limit` events are inside the union of each source's top `limit`. The per-source cap does not drop an event that belongs on the first page. There is no cursor for the next page. `timelineContinues` tells the client the page is not the whole deal. Not changed.
- Meeting-intel pages with a numeric offset and orders by `heldAt`, then `id`. The sort is stable. Offset still moves when rows are inserted between requests. Replacing that cursor would change the wire contract. Not changed.

## How this was checked

Node 24.11.1 and pnpm 10.27.0. PostgreSQL 16 and Redis on this VM. `prisma migrate deploy` twice, as above. Each fix was a failing assertion first, then the change, then the same test green. The commands are on the PRs.
