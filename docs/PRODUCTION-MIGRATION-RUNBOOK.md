# Production Migration Remediation Runbook

> Authored 2026-05-30 from the production-readiness DB review. **Advise-only** —
> these touch migration history and must be executed by an operator who can see
> `_prisma_migrations` on each environment. Do NOT blind-apply.

The migration directory currently has integrity issues that will **abort or
corrupt `prisma migrate deploy`** in a fresh environment. Resolve all four
before the first production deploy. Work on a branch; verify on staging first.

---

## Pre-flight: capture applied state on every environment

```sql
-- Run against staging AND prod (and any shared dev DB):
SELECT migration_name, finished_at
FROM _prisma_migrations
ORDER BY started_at;
```

Save the output. Every decision below branches on whether a given migration row
is already present.

---

## BLOCKER 1 — Duplicate migration timestamp `20260530000000`

Two directories share the same prefix:

```
migrations/20260530000000_add_proposal_wave9b_fields/   (emergency hotfix for the Wave9b 500s)
migrations/20260530000000_rfp_pipeline_completion/      (enum expansion + pipeline columns)
```

Prisma orders lexicographically; with identical prefixes the order between them
is filesystem-dependent → non-deterministic apply + `prisma migrate dev` "drift"
errors in CI.

**Fix (safe only if NEITHER is yet applied to staging/prod — verify with the
pre-flight query):**

1. Rename the hotfix to land first, on a unique later-incrementing prefix:
   ```
   git mv packages/db/prisma/migrations/20260530000000_add_proposal_wave9b_fields \
          packages/db/prisma/migrations/20260530000050_add_proposal_wave9b_fields
   ```
2. Both migrations use `ADD COLUMN IF NOT EXISTS`, so the order is harmless on a
   DB where one already ran — but the rename still must be reflected in
   `_prisma_migrations`. If a row for `20260530000000_add_proposal_wave9b_fields`
   already exists on an environment, update it there in the same maintenance window:
   ```sql
   UPDATE _prisma_migrations
   SET migration_name = '20260530000050_add_proposal_wave9b_fields'
   WHERE migration_name = '20260530000000_add_proposal_wave9b_fields';
   ```
3. Re-run `pnpm db:generate` (Windows: stop the API/worker first — the Prisma
   query-engine DLL is locked while they hold `@bidstack/db`).

---

## BLOCKER 2 — Deleted migration `20260524000000_add_tenant_export`

The working tree shows `D packages/db/prisma/migrations/20260524000000_add_tenant_export/migration.sql`;
a replacement `20260524000100_add_tenant_export` exists (renamed per MIGRATION_HYGIENE.md).

`prisma migrate deploy` treats a migration present in `_prisma_migrations` but
**absent on disk** as a "missing migration" and **aborts the deploy**.

**Decision (branch on the pre-flight query):**

- **If any env's `_prisma_migrations` has a row for `20260524000000_add_tenant_export`:**
  restore the file as a tombstone (its content is in git history) so the row
  still resolves; do NOT delete it:
  ```
  git checkout <last-commit-with-it> -- packages/db/prisma/migrations/20260524000000_add_tenant_export/migration.sql
  ```
- **If NO env has that row** (it was only ever local before being superseded):
  the deletion is safe — commit it formally:
  ```
  git rm -r packages/db/prisma/migrations/20260524000000_add_tenant_export
  ```

---

## BLOCKER 3 — `RfpOrchestration.completedPhases` type mismatch

`schema.prisma` declares `completedPhases RfpResponsePhase[]` (native enum array),
but `20260527000000_rfp_vector_indexes/migration.sql` created the column as
`TEXT[]`. Reads work (Postgres casts text→enum) but introspection/`migrate reset`
will flag drift, and strict enum casts can fail.

**Fix** — add a new migration AFTER the enum-expansion migration
(`20260530000000_rfp_pipeline_completion`, which `ADD VALUE`s the new phases):

```sql
-- migrations/20260531000000_fix_completed_phases_type/migration.sql
ALTER TABLE "rfp_orchestrations"
  ALTER COLUMN "completed_phases" TYPE "RfpResponsePhase"[]
  USING "completed_phases"::"RfpResponsePhase"[];
```

Pre-req: every existing value in `completed_phases` must already be a valid enum
member (it will be, since the app only writes enum values). Run after the enum
has all 9 values.

---

## MAJOR — `RfpOrchestrationState.awaiting_approval` not in baseline

`schema.prisma` includes `awaiting_approval`, but the baseline
`20260527000000_rfp_vector_indexes` create only had the original states;
`20260530000000_rfp_pipeline_completion` adds it via `ALTER TYPE ... ADD VALUE IF NOT EXISTS`.

**Action:** confirm `20260530000000_rfp_pipeline_completion` is applied to an
environment **before** any code path writes `state = 'awaiting_approval'` there.
Until then the API will throw `invalid input value for enum`. Gate the
RFP-approval feature flag on the migration being deployed.

> Note: `ALTER TYPE ... ADD VALUE` cannot run inside a transaction (PG limitation).
> The migration correctly runs it outside one — a mid-migration failure leaves a
> partially-expanded enum with no rollback. Re-running is safe (`IF NOT EXISTS`).

---

## After all four

```
pnpm db:generate              # stop API/worker first on Windows (DLL lock)
pnpm --filter @bidstack/db ... # regenerate client
# On a throwaway DB, prove a clean deploy from zero:
#   createdb bidstack_migtest && DATABASE_URL=...migtest prisma migrate deploy
# Expect: all migrations apply in order, no drift, no "missing migration".
```

Update `packages/db/prisma/migrations/MIGRATION_HYGIENE.md` (its applied/pending
table is ~14 migrations stale) so the human record matches `_prisma_migrations`.
