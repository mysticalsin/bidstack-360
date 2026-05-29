# Audit Report — Background Workers Domain

**Scope:** `apps/worker/src/**/*.ts`, BullMQ queue definitions, job processors  
**Rubric:** Infra 25 + Functional 25  
**Date:** 2026-05-23  
**Auditor:** Agent-10 (read-only)

---

## 1. Score

**52 / 100**

| Dimension  | Score   | Notes                                                                                                                                      |
| ---------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Infra      | 14 / 25 | Strong queue-config parity and shutdown hygiene, but missing DLQs, monitoring, stalled-job handlers, and race-prone circuit-breaker state. |
| Functional | 18 / 25 | Good Zod validation, job signing, and retry backoff definitions; catastrophic wiring gap leaves the entire call-processing pipeline dead.  |

---

## 2. Strengths

- **Centralised queue configuration with producer/consumer parity**  
  `packages/shared/src/queue-config.ts:1-374` defines every queue’s `attempts`, `backoff` (exponential or fixed), `removeOnComplete`, and `removeOnFail` in one file. Every worker in `apps/worker/src/queues/*` imports the same constants, preventing drift between API producers and worker consumers.

- **Zod schemas for job payloads**  
  Almost every processor validates inbound data with Zod before touching the DB, e.g.:
  - `apps/worker/src/queues/company-enrich-apollo.ts:26-33` — `ApolloEnrichJobData`
  - `apps/worker/src/queues/document-extract.ts:536-548` — `JobData`
  - `apps/worker/src/queues/webhook-delivery.ts:43-50` — `DeliveryJobSchema`

- **Graceful shutdown with timeout**  
  `apps/worker/src/main.ts:93-111` closes all workers, then all queues, then the Redis connection, with a 10-second forced-exit safety net.

- **Rate limiters and concurrency controls**
  - SMS: `apps/worker/src/queues/sms.ts:223` — `concurrency: 1` + `limiter: { max: 1, duration: 1_000 }` (Twilio A2P 10DLC compliance).
  - Document extract: `apps/worker/src/queues/document-extract.ts:753` — `limiter: { max: 10, duration: 60_000 }`.
  - Email sync: `apps/worker/src/queues/email-sync.ts:392` — `limiter: { max: 10, duration: 1_000 }`.

- **HMAC job-signature verification**  
  `apps/worker/src/queues/company-enrich-apollo.ts:128-145` verifies `signature` with `timingSafeEqual`, rejecting forged enrichment jobs in production.

---

## 3. P0 Gaps (Production-Critical)

### 3.1 Call-processing pipeline is completely unwired

`apps/worker/src/queues/calls.ts:351` exports `startCallWorkers`, but **`apps/worker/src/main.ts`** never imports or calls it. The four queues (`call.fetch-recording`, `call.transcribe`, `call.analyze`, `call.update-deal`) and their workers are defined but never instantiated, meaning:

- Call recordings are never fetched.
- Transcriptions are never created.
- LLM analysis (MEDDIC, sentiment) never runs.
- Deal-update suggestions never surface.

**Evidence:**

```ts
// apps/worker/src/main.ts:12-26 — no import from './queues/calls.js'
import { startCompanyEnrichApollo } from './queues/company-enrich-apollo.js';
import { startDustPoller } from './queues/dust-poll.js';
// ... 12 other starters, calls.ts absent
```

### 3.2 No dead-letter queue (DLQ) for any worker

Every queue config specifies `removeOnFail: { age, count }`, which silently drops expired jobs after the retention window. There is **no BullMQ `flows` or dedicated DLQ** where failed jobs can be inspected, replayed, or alerted on. This violates the rubric’s “Dead-letter queue handling” criterion.

**Evidence:**

```ts
// packages/shared/src/queue-config.ts:36-43 (typical pattern)
export const COMPANY_ENRICH_APOLLO: QueueConfig = {
  name: 'company-enrich-apollo',
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 30_000 },
    removeOnComplete: { age: 86_400, count: 200 },
    removeOnFail: { age: 604_800, count: 5000 },
  },
};
// No `flows` reference anywhere in apps/worker/src.
```

### 3.3 Dust-poll circuit breaker is process-local and racy

`apps/worker/src/queues/dust-poll.ts:30-33` uses module-level mutable state:

```ts
let consecutiveFailures = 0;
const CIRCUIT_THRESHOLD = 3;
let circuitOpenUntil = 0;
```

With `concurrency` unbounded (defaults to 1, but not explicitly set), and especially if ever raised, multiple concurrent jobs can race on `consecutiveFailures++`. Worse, the state is **lost on process restart**, so a horizontally-scaled worker fleet has no shared circuit state.

### 3.4 Webhook delivery auto-disable logic is delayed

`apps/worker/src/queues/webhook-delivery.ts:169-170`:

```ts
const newFailureCount = sub.failureCount + 1;
const shouldDisable = newFailureCount >= AUTO_DISABLE_AFTER && attempt >= 5;
```

A subscription can exceed 10 failures across multiple events/jobs, but **will not be disabled until the 5th attempt of some later job**. If jobs fail fast (network timeout), the 5-attempt ceiling is reached quickly per job, but the subscription could rack up 50+ failures before the disable gate opens.

### 3.5 Scheduled jobs lack stable `jobId`s → duplicate cron risk

`apps/worker/src/queues/dust-poll.ts:47-55` and `apps/worker/src/queues/webhook-processor.ts:39-47` add repeatable jobs without a `jobId`:

```ts
await queue.add(
  'dust.poll',
  { source: 'scheduled' },
  {
    repeat: { every: REPEAT_EVERY_MS },
    removeOnComplete: { age: 3600, count: 100 },
    removeOnFail: { age: 86400 },
  },
);
```

BullMQ deduplicates repeatables by an internal key, but relying on implicit keys is brittle. Explicit `jobId` is the documented safe pattern (contrast `yjs-compaction.ts:160` which does it correctly: `jobId: 'yjs-compact-scheduled'`).

### 3.6 Document-extract worker never creates a Queue handle

`apps/worker/src/queues/document-extract.ts:747-755`:

```ts
const queue = new BullWorker<JobData>(
  QUEUE_NAME,
  async (job) => processJob(job, log.child({ jobId: job.id })),
  { connection, concurrency: 2, limiter: { max: 10, duration: 60_000 } },
);
```

The variable is named `queue` but is a `Worker`. The `_queues` parameter is ignored, so no `Queue` instance is registered for shutdown or for API-side inspection.

---

## 4. P1 Gaps (Performance / Observability / Scheduling)

### 4.1 No queue monitoring or Bull Board

There is no `@bull-board/express` (or similar) mount, no Prometheus metrics for queue depth/wait-time/failure-rate, and no `worker.on('stalled')` handlers. Operational blind spot.

### 4.2 CS workers bypass shared `queue-config.ts`

`apps/worker/src/queues/cs.ts:50-55` defines inline `defaultJobOptions` rather than importing from `@bidstack/shared`. This breaks the producer/consumer parity guarantee documented in `queue-config.ts`.

### 4.3 Calendar push does not handle 429 rate limits

`apps/worker/src/queues/calendar-sync.ts:260-344` (`handleGooglePush`) and `:348-417` (`handleMicrosoftPush`) throw generic errors on non-2xx, but do not catch `429` or respect `Retry-After`. Contrast `email-sync.ts:172-176` which does this correctly with `RateLimitError` + `job.moveToDelayed()`.

### 4.4 Y.js compaction has a read-time race window

`apps/worker/src/queues/yjs-compaction.ts:78-80`:

```ts
const docsWithUpdates = await prisma.$queryRaw<Array<{ id: string }>>`
  SELECT DISTINCT ydoc_id AS id FROM yjs_updates
`;
```

This `DISTINCT` query is **outside any transaction**. If concurrency were ever raised above 1, two workers could select the same `ydoc_id` and collide. (Current `concurrency: 1` mitigates, but the pattern is unsafe.)

### 4.5 Predictive retrain cron is registered on every worker start

`apps/worker/src/queues/predictive-retrain.ts:144-151`:

```ts
await queue.add(
  'retrain:weekly-cron',
  { all: true },
  {
    repeat: { pattern: '0 2 * * 0' },
    jobId: 'predictive-weekly-retrain',
  },
);
```

While `jobId` stabilises the repeatable entry, there is no guard for multiple worker processes (e.g. in Kubernetes with replicas > 1). Each replica will call `queue.add` on boot, creating redundant repeatable entries unless BullMQ’s deduplication perfectly catches them.

---

## 5. P2 Gaps (Nice-to-Have)

- **No priority queues** — All jobs are FIFO. High-priority webhook deliveries or calendar pushes cannot jump ahead of bulk background work.
- **No batch inserts in dust-poll** — `apps/worker/src/queues/dust-poll.ts:77-86` loops `prisma.syncEvent.createMany` per org inside a `for…of` over documents, then again at line 140-155. Could be batched.
- **Hard-coded magic numbers scattered** — e.g. `100_000` char slice in `document-extract.ts:592`, `30` day cache expiry in `company-enrich-apollo.ts:294`, `7` day watch expiry in `calendar-sync.ts:748`. No centralised tunables.
- **TODOs in production code** — `apps/worker/src/queues/calls.ts:148` (`// TODO: implement when delegated recording access is configured`) and `calendar-sync.ts:728` (`// TODO: replace GOOGLE_WEBHOOK_URL`).

---

## 6. Evidence (Code Snippets)

### 6.1 Missing call-worker bootstrap

```ts
// apps/worker/src/main.ts
// Missing:
// import { startCallWorkers } from './queues/calls.js';
// await startCallWorkers(connection, log, workers, queues);
```

### 6.2 Race-prone circuit breaker

```ts
// apps/worker/src/queues/dust-poll.ts:30-33
let consecutiveFailures = 0;
const CIRCUIT_THRESHOLD = 3;
const CIRCUIT_COOLDOWN_MS = 10 * 60 * 1000;
let circuitOpenUntil = 0;
```

### 6.3 Webhook disable gate too late

```ts
// apps/worker/src/queues/webhook-delivery.ts:169-170
const newFailureCount = sub.failureCount + 1;
const shouldDisable = newFailureCount >= AUTO_DISABLE_AFTER && attempt >= 5;
```

### 6.4 Document-extract worker misnamed

```ts
// apps/worker/src/queues/document-extract.ts:747-755
export async function startDocumentExtract(...) {
  const queue = new BullWorker<JobData>(...); // <-- Worker, not Queue
  workers.push(queue);
}
```

### 6.5 Dust-poll repeatable without stable jobId

```ts
// apps/worker/src/queues/dust-poll.ts:47-55
await queue.add(
  'dust.poll',
  { source: 'scheduled' },
  {
    repeat: { every: REPEAT_EVERY_MS },
    removeOnComplete: { age: 3600, count: 100 },
    removeOnFail: { age: 86400 },
    // jobId absent
  },
);
```

### 6.6 Y.js compaction non-transactional DISTINCT

```ts
// apps/worker/src/queues/yjs-compaction.ts:78-80
const docsWithUpdates = await prisma.$queryRaw<Array<{ id: string }>>`
  SELECT DISTINCT ydoc_id AS id FROM yjs_updates
`;
for (const { id: ydocId } of docsWithUpdates) {
  // ... each compacted in its own transaction, but the list itself is stale
}
```

---

## 7. Summary

The Background Workers domain shows **strong architectural intent** (centralised config, Zod validation, structured logging, rate limiters) but suffers from **critical execution gaps**. The most severe is the unwired call-processing pipeline, which renders an entire Wave-8 feature set inert. Secondary but serious are the absence of DLQs, race-prone circuit-breaker state, and inconsistent idempotency practices for scheduled jobs. Closing the P0 gaps would raise the score into the 75-80 range.
