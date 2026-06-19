# RFP Upload Load Gate Harness

## Problem

The root `pnpm load-test:rfp` gate must certify the live RFP upload route plus BullMQ intake, but it can rot independently from API package code. In June 2026 it failed before the real load path because it:

- imported `dotenv`, `tsx`, `bullmq`, `ioredis`, and Prisma from the root without direct root dependencies,
- imported Prisma before env files were loaded,
- created `FileAttachment` rows with old schema fields,
- reused one `rfpRequestId` across concurrent uploads, causing expected uniqueness conflicts to look like load failures,
- cleaned only file rows, leaving possible orchestration/document/queue artifacts.

## Pattern

Keep the harness as a first-class root tool:

- Declare every package imported by the root script in root `devDependencies`.
- Load root and API env files before importing `@bidstack/db`.
- Use explicit loopback values on Windows: `API_URL=http://127.0.0.1:<port>` and `REDIS_URL=redis://127.0.0.1:6380`.
- Generate a unique `rfpRequestId` per simulated upload; use a separate duplicate-request regression test for the 409 path.
- Track all generated request IDs and file IDs, then clean `AuditLog`, `RfpOrchestration`, `DocumentVersion`, `BidDocument`, `FileAttachment`, and BullMQ jobs.
- Wrap upload route document/version/orchestration writes in a single Prisma transaction so a uniqueness failure cannot leave partial document records.

## Gate

Start a fresh API process with current code, then run:

```powershell
$env:API_URL='http://127.0.0.1:4601'
$env:REDIS_URL='redis://127.0.0.1:6380'
pnpm load-test:rfp
```

Expected result:

- HTTP-10 phase: `10/10` accepted with p95 under `2000ms`.
- HTTP-50 phase: about `10` accepted and `40` rate-limited with no unexpected statuses.
- Queue-50 phase: `50/50` BullMQ jobs enqueued under `5s`.
- Cleanup deletes current-run DB and queue artifacts.

## Verification Snapshot

2026-06-17 local gate after the fix:

- HTTP-10: `10/10` accepted, p95 `242ms`.
- HTTP-50: `10x202`, `40x429`, p95 `294ms`.
- Queue-50: `50/50` jobs in `14ms`.
- Cleanup: `20` orchestration/audit/document records, `60` file rows, and `70` current-run jobs removed.
