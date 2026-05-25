# Worker/Queue Reliability Audit

## Summary
- **Job processors:** 4 (`dust-poll`, `webhook-processor`, `company-enrich-apollo`, `document-extract`)
- **Retry configs:**
  - `COMPANY_ENRICH_APOLLO`: 5 attempts, exponential backoff 30s
  - `DUST_POLL`: 3 attempts, exponential backoff 5s
  - `DUST_WEBHOOK_PROCESSOR`: 3 attempts, exponential backoff 5s
  - `DOCUMENT_EXTRACT`: 3 attempts, exponential backoff 5s
- **Error handling coverage:** ~75% — operational try/catch present, but missing worker-level error event handlers, no DB transactions around multi-step side effects, and some errors swallowed silently.
- **Top risk:** Deterministic validation failures are retried wastefully, and mid-crash partial writes leave the CRM DB in an inconsistent state (stale `running` statuses, duplicate audit logs).

## Findings

| Severity | File | Line | Issue | Fix |
|----------|------|------|-------|-----|
| **HIGH** | `apps/worker/src/queues/company-enrich-apollo.ts` | 233-235 | Invalid job signature throws, triggering 5 retries with exponential backoff. Signature verification is deterministic — retries will never succeed, wasting queue capacity and delaying observability. | Throw a `UnrecoverableError` (BullMQ) or call `job.moveToFailed(..., true)` to fail fast without retries. |
| **HIGH** | `apps/worker/src/queues/document-extract.ts` | 252-255 | `documentExtraction` status set to `running` at job start, but no stale-job reaper exists. If the worker process crashes or is SIGKILLed, the row stays `running` forever. | Add a `updatedAt` timeout reaper (e.g., reset jobs stuck >30 min) or use a Redis-based heartbeat. |
| **HIGH** | `apps/worker/src/queues/document-extract.ts` | 333-398 | Solutions/products upserts and final `documentExtraction` status update are not wrapped in a Prisma transaction. A crash after partial writes leaves orphaned data and an inconsistent extraction state. | Wrap the DB writes in `$transaction` so all succeed or roll back together. |
| **MEDIUM** | `apps/worker/src/queues/webhook-processor.ts` | 61-134 | Side effects (upserts + `auditLog.create`) and the `syncEvent.updateMany` status flip are not atomic. A crash between the two causes re-processing on the next tick. | Wrap each event's side effects and status update in a Prisma `$transaction`. |
| **MEDIUM** | `apps/worker/src/main.ts` | 34-42 | No `worker.on('error')` or `queue.on('error')` handlers attached after bootstrap. BullMQ Redis/BPS errors may surface as unhandled exceptions. | Attach `error` listeners to all workers/queues and route to Pino. |
| **MEDIUM** | `apps/worker/src/queues/dust-poll.ts` | 30-33 | Circuit-breaker state (`consecutiveFailures`, `circuitOpenUntil`) is module-local. In a multi-replica deployment, failures are not aggregated and the circuit never opens reliably. | Move circuit state to Redis (e.g., `connection.set('dust-poll:circuit', ...)`) or use a dedicated circuit-breaker lib. |
| **MEDIUM** | `apps/worker/src/queues/company-enrich-apollo.ts` | 270-331 | `auditLog.create` lacks an idempotency key. On BullMQ retry, duplicate audit rows are inserted even though the enrichment upsert is idempotent. | Add a unique constraint on `(targetType, targetId, action, jobId)` or skip `auditLog.create` if `job.attempts > 1` and the enrichment already exists. |
| **MEDIUM** | `apps/worker/src/queues/document-extract.ts` | 419-434 | Failure handler calls `prisma.documentExtraction.updateMany(...).catch(() => undefined)`, silently swallowing DB errors and masking outages. | Remove the blind `.catch`; log the error and let the worker health-check surface it. |
| **LOW** | `apps/worker/src/queues/dust-sync-helpers.ts` | 168, 220 | Upserts use `where: { id: existing?.id ?? '' }`, relying on Prisma missing empty-string IDs. If the DB enforces valid UUIDs or the ORM behavior changes, this throws. | Use `create` + `update` branches explicitly, or upsert by a stable natural key. |
| **LOW** | `Dockerfile` | 82-104 | Worker target has no `HEALTHCHECK`. The orchestrator cannot auto-restart a hung or deadlocked worker container. | Add a `HEALTHCHECK` that probes worker liveness (e.g., Redis heartbeat or a lightweight IPC check). |
