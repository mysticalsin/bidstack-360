---
title: A safety guard can be the only thing that breaks the job — and mocked tests will never tell you
date: 2026-08-18
project: BidStack 360° (D:\BIDCRM)
tags: [lessons, prisma, postgres, testing, observability]
---

## Lesson — run the process and read its log; unit tests cannot see driver-level failures

**Rule (ALWAYS):** For scheduled/background work, verification means **starting the process
and reading its output**, not just running its unit tests. And when a job talks to the
database through raw SQL, at least one test must execute that SQL against a **real**
database — a mocked client returns whatever the mock says and cannot reproduce a
driver-level type error.

**What happened:** Starting the worker during a full-stack check surfaced a nightly job
failing on every run:

```
Invalid `prisma.$queryRaw()` invocation:
Raw query failed. Message: `Failed to deserialize column of type 'regclass'.`
```

The AI-audit retention purge (90-day GDPR storage limitation) begins with a guard so it
no-ops in environments where the `ai_invocations` migration has not run:

```sql
SELECT to_regclass('ai_invocations') AS reg
```

`to_regclass()` returns Postgres type `regclass`. The Prisma engine cannot deserialize it,
so the query throws — meaning **the guard written to make the job safe was the one thing
guaranteeing it never completed**. The purge had never run. The only symptom was an error
in a log nobody read; nothing user-facing broke, no test failed, and the data just kept
accumulating past its retention window.

The fix is one cast, `to_regclass('ai_invocations')::text`, which keeps the semantics
exactly (to_regclass returns NULL for a missing table; NULL::text is still NULL).

**Root cause, two layers:**
1. A defensive branch was written but never executed against a real database.
2. The only test on the module covered `resolveRetentionDays` — pure config parsing. The
   function that actually touches Postgres had no test at all, and a mocked `$queryRaw`
   would have passed regardless of the cast.

**How to apply:**
- Treat "the worker boots and logs no errors" as a required verification step, alongside
  tests. Count `prisma:error` / `ERROR` lines in the startup log; a healthy worker has zero.
- Any `$queryRaw` returning a Postgres-specific type (`regclass`, `regtype`, `oid`, enums,
  `interval`, ranges) must be cast to a Prisma-supported type at the SQL boundary.
- Put the regression in a `*.contract.test.ts` that hits a real DB and **fails loud** when
  DATABASE_URL is unreachable. Assert both directions: the cast works AND the uncast form
  throws — so removing the cast fails a test instead of silently stopping the job.
- Be suspicious of guards. A branch that exists to prevent a rare failure runs on the
  common path too; if it is wrong, it converts "sometimes broken" into "always broken".
