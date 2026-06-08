# Mutation Audit Safety Net

## Problem

The CRM needs evidence that authenticated write attempts are tracked, but many
routes already create rich, entity-specific audit rows inside the same
transaction as the business write. Adding a generic audit row to every mutation
duplicates those hot paths and can create unnecessary database pressure during
large test or production bursts.

## Pattern

- Keep rich domain audit rows as the primary evidence for core CRM entities.
  They should remain atomic with the business mutation.
- Add a request-level safety net only for route families that do not yet have
  rich domain audit coverage.
- Never store request bodies, credentials, query strings, cookies, or bearer
  tokens in the safety-net row.
- Store API-key pseudo users as `userId: null` and keep the original actor id in
  `diff.actorId`, because `audit_log.user_id` is a UUID foreign key.
- Record successful authenticated writes as `http.mutation.success`.
- Record authenticated forbidden write attempts as `http.mutation.denied`.
- Keep public webhook routes out of the safety net unless they resolve a trusted
  tenant and have their own explicit audit contract.
- Include meaningful enterprise write surfaces that lack rich domain audit rows:
  comments, mentions, calls, signatures, forecasts, lead routing, admin actions,
  edit locks, migration mappings, email/SMS sends, booking pages, service cases,
  and integration connect/disconnect/resync actions.
- Keep known rich-audited write routes out of the safety net, even when nearby
  route families still need generic coverage. Example: manual company
  create/update/delete now writes `company.create`, `company.update`, and
  `company.delete` transactionally, and `/api/v1/companies/:id/tier` writes
  `company.tier.update`, so those paths should not get duplicate request-level
  rows.
- Treat RBAC/admin permission mutations as high-value rich-audit paths. Role
  create/update/delete writes `role.create`, `role.update`, and `role.delete`
  rows in the same transaction as the business write, with role names,
  permission IDs, permission keys, and before/after changes for export review.
  `/api/v1/roles` and `/api/v1/roles/:id` should not also receive generic
  `http.mutation.success` rows.
- Do not audit ephemeral heartbeats such as `/api/v1/presence`. At enterprise
  scale those events create noisy, high-volume operational telemetry, not useful
  compliance evidence.

## Verification

- `pnpm --filter @bidstack/api exec vitest run src/plugins/mutation-audit.test.ts --reporter=dot`
- `pnpm --filter @bidstack/api exec vitest run src/routes/companies.test.ts src/plugins/mutation-audit.test.ts src/routes/audit-logs.test.ts --reporter=dot`
- `pnpm --filter @bidstack/api exec vitest run src/routes/roles.integration.test.ts src/plugins/mutation-audit.test.ts --reporter=dot`
- `pnpm --filter @bidstack/api exec vitest run src/routes/audit-logs.test.ts src/routes/contacts.integration.test.ts src/routes/opportunities.integration.test.ts src/routes/invoices.integration.test.ts src/routes/sales-orders.integration.test.ts src/routes/notes.test.ts src/routes/bid-workspace.integration.test.ts --reporter=dot`
- `pnpm --filter @bidstack/api typecheck`
- `pnpm --filter @bidstack/api exec eslint src/plugins/mutation-audit.ts src/plugins/mutation-audit.test.ts src/server.ts --quiet`
- `pnpm --filter @bidstack/api test`
- `pnpm --filter @bidstack/api build`

## Notes

Do not make this plugin log every route by default. If a new route family gains
rich atomic audit coverage, remove it from the safety-net prefix list. If a new
route family lacks rich audit coverage, add it to the list with a focused test.
