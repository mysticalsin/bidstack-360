# POLO-IMPORT-WIZARD-QA-FIXES

Ticket: POLO-IMPORT-WIZARD-QA-FIXES
Owner / validator: Devin (Polo interim owner)
Base: `1eada22cad1a82030941dc72506e07fbc6897859` (main)
Branch: `cursor/polo-import-wizard-qa-fixes-3acf`

Inspector's hands-on QA of the CSV import wizard on that commit found three defects. This change fixes those three. It does not deploy, does not touch the live polo-preview Worker, and does not merge.

## Findings

- **H-1 (High).** At a 390px viewport the Maps-to controls are clipped by the `overflow-hidden` table in `CsvImportWizard`. A phone user cannot see or use them. `Account Name` also does not auto-map to Name, so the required field stays blank.
- **M-1 (Medium).** Cancel waits on the job-row lock a chunk holds inside a 120s transaction (`apps/worker/src/queues/migration.ts` `FOR UPDATE`). That transaction timeout does not cancel the blocked statement, so a hung statement means Cancel never returns.
- **M-2 (Medium).** Two Retry clicks send two requests. The loser is a 409 `Migration job is no longer failed`, shown in red, untranslated, on a job that already completed.

Auto-map for Account Name, Employees, and Country is in scope. It is a few exact header aliases and the phone test needs Name to come up mapped.

## Done when

- [ ] At 390×844 the Maps-to control for each column is visible, its bounding box lies inside the viewport, it can be changed, and Name is mapped (`company.name`).
- [ ] Account Name, Employees, and Country auto-map to Name, Employee count, and Country code.
- [ ] At 1440 the desktop table still shows Maps to, and the same three headers are mapped.
- [ ] While a chunk holds `migration_jobs` `FOR UPDATE`, `DELETE /api/v1/migrations/:id/cancel` returns within `CANCEL_RESPONSE_BOUND_MS` (5000), records `migration.cancel.requested`, and leaves the row RUNNING until the chunk observes the mark.
- [ ] A chunk that sees `migration.cancel.requested` writes no imported rows and moves the job to CANCELLED.
- [ ] Two Retry clicks send one request. A 409 `Migration job is no longer failed` renders no error text. Any conflict text that is still shown goes through `t()`.
- [ ] `pnpm test`, `pnpm lint`, and `pnpm typecheck` are reported with counts and exit codes.
- [ ] A mutant of each fix goes red, then the mutant is reverted.
- [ ] PR into `main` contains the value headline, red and fix SHAs, mutants, rollback, the unslop table, and screenshots at 390 and 1440.

## Failing tests (red before the fix)

| Finding | Test name | File |
| --- | --- | --- |
| H-1 | `maps-to controls sit inside a 390x844 viewport and Name is mapped` | `apps/web/e2e/flows/csv-import-wizard-mobile.spec.ts` |
| H-1 | `maps Account Name, Employees, and Country onto the company fields` | `apps/web/src/lib/csv-parse.test.ts` |
| M-1 | `returns within CANCEL_RESPONSE_BOUND_MS while a chunk holds the job row lock` | `apps/api/src/routes/migrations.cancel-lock.integration.test.ts` |
| M-1 | `a cancel request stops the chunk from writing rows and cancels the job` | `apps/worker/src/queues/migration.cancel-request.test.ts` |
| M-2 | `two Retry clicks send one request and show no error when the job is no longer failed` | `apps/web/src/components/import/CsvImportWizard.test.tsx` |

`CANCEL_RESPONSE_BOUND_MS` is 5000. It is longer than the handler's 2s `lock_timeout` and far shorter than the chunk's 120s transaction.

## TEST COMMAND

Focused red/green commands, from the repo root, with Node 24 on `PATH`:

```bash
export DATABASE_URL=postgres://bidstack:bidstack_test@127.0.0.1:5432/bidstack_test
export REDIS_URL=redis://127.0.0.1:6379
export PATH="$HOME/.nvm/versions/node/v24.22.3/bin:$PATH"

pnpm --filter @bidstack/web exec vitest run src/lib/csv-parse.test.ts src/components/import/CsvImportWizard.test.tsx
pnpm --filter @bidstack/api exec vitest run src/routes/migrations.cancel-lock.integration.test.ts
pnpm --filter @bidstack/worker exec vitest run src/queues/migration.cancel-request.test.ts
pnpm --filter @bidstack/web exec playwright test e2e/flows/csv-import-wizard-mobile.spec.ts --project=chromium-desktop
```

Full gate after the fixes:

```bash
pnpm test
pnpm lint
pnpm typecheck
```
