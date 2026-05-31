# MemOS trace P2023 — non-UUID actor on a UUID column

**Problem:** Every RFP worker job (`rfp-requirement-extract`, `rfp-story-match`,
`rfp-section-draft`) spammed a Prisma error on each run:

```
Invalid `prisma.memosTrace.create()` invocation:
Inconsistent column data: Error creating UUID, invalid character:
expected an optional prefix of `urn:uuid:` followed by [0-9a-fA-F-], found `s` at 1
```

It was caught and logged as `MemOS L1 trace failed — non-critical` (WARN), so the
pipeline completed, but the trace was silently dropped and the log was noisy.

**Diagnosis:** `MemOSService.logTrace(...)` was called with `userId: 'system'`
(a literal sentinel) from system-initiated jobs, while `MemosTrace.userId` is a
`@db.Uuid` column. `'system'` is not a UUID (`found 's' at 1` = its leading `s`),
so Postgres rejected the insert with P2023. The column has **no foreign key** —
it is a bare actor UUID — so there is no users row to point at for system traces.

**Fix:** Coerce non-UUID actors to `NULL` centrally, in one place, so every
current and future caller is fixed at once (DRY).

- `packages/db/prisma/schema.prisma` — make the column nullable:
  `userId String? @map("user_id") @db.Uuid`
- `packages/db/prisma/migrations/20260531010000_memos_trace_user_id_nullable/` —
  `ALTER TABLE "memos_traces" ALTER COLUMN "user_id" DROP NOT NULL;`
- `packages/memos/src/index.ts` — guard inside `logTrace`:

  ```ts
  const ACTOR_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  const isUuidActor = ACTOR_UUID_PATTERN.test(event.userId);
  const userId = isUuidActor ? event.userId : null; // NULL = system
  const metadata = {
    ...(event.metadata ?? {}),
    ...(isUuidActor ? {} : { actor: event.userId }), // keep 'system'
  };
  ```

**Why it works:** With no FK on the column, `NULL` is the correct model for
"no user / system-initiated"; the insert now satisfies the UUID type. Real user
IDs (e.g. `bid-scores.ts` passing `req.auth.userId`) still match the pattern and
pass through untouched, so the `[orgId, userId]` index and audit trail stay
accurate. The original actor string is preserved in `metadata.actor`, so system
traces remain distinguishable without abusing the UUID column with a sentinel.
The non-critical `try/catch` stays as a safety net but no longer fires for this.

**Prevention:**

- `packages/memos/src/index.test.ts` asserts both paths: a sentinel actor
  (`'system'`) is stored as `userId: null` with `metadata.actor === 'system'`,
  and a real UUID is passed through with no `actor` key added. These fail if
  someone reintroduces a raw-string write to the UUID column.
- Rule: never write a caller-supplied string straight into a `@db.Uuid` column.
  Validate or coerce at the service boundary; sentinels become `NULL`.

> Deploy note: after pulling this, the migration must be applied to each
> environment (`pnpm db:migrate:deploy`) and the Prisma client regenerated
> (`pnpm db:generate`) so the runtime column and the generated types both
> reflect the nullable `user_id`.
