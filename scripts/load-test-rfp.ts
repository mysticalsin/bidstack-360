/**
 * W10-P2-1 — RFP upload pipeline load test
 *
 * Validates the system can handle bursts of concurrent RFP uploads without
 * deadlocking the queue, exhausting Redis connections, or corrupting tenant data.
 *
 * Phases:
 *   1. SETUP     — seed FileAttachment rows + locate seed opportunity/org
 *   2. HTTP-10   — 10 concurrent uploads from seed org (all must succeed, rate ≤ 10/hr)
 *   3. HTTP-50   — 50 concurrent uploads (first 10 → 202, next 40 → 429 rate-limit)
 *   4. QUEUE-50  — directly enqueue 50 rfp.orchestrate jobs to stress BullMQ
 *   5. SNAPSHOT  — report queue depth (waiting/active/completed/failed)
 *   6. REPORT    — print p50/p95/p99 latency + pass/fail verdict
 *   7. CLEANUP   — delete test FileAttachment rows + reset rate-limit key
 *
 * Prerequisites: API running at API_URL (default http://localhost:4000) in dev mode
 * (stub auth, no CLERK_SECRET_KEY).  Redis at REDIS_URL (default redis://localhost:6380).
 *
 * Usage:
 *   pnpm tsx scripts/load-test-rfp.ts
 *   API_URL=http://localhost:4000 REDIS_URL=redis://localhost:6380 pnpm tsx scripts/load-test-rfp.ts
 */

/* eslint-disable no-console -- load test is a CLI tool; console.log IS the output interface */

import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Load root/apps API env files so DATABASE_URL + REDIS_URL are available.
// Keep this script dependency-free at the repo root: pnpm runs it from the
// workspace package, where dotenv is not installed.
const __dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dir, '..');

function loadEnvFile(path: string): void {
  if (!existsSync(path)) return;

  const content = readFileSync(path, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!match) continue;

    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;

    const value = rawValue.trim();
    process.env[key] =
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
        ? value.slice(1, -1)
        : value;
  }
}

loadEnvFile(resolve(repoRoot, '.env'));
loadEnvFile(resolve(repoRoot, '.env.local'));
loadEnvFile(resolve(repoRoot, 'apps/api/.env'));
loadEnvFile(resolve(repoRoot, 'apps/api/.env.local'));

// ─── Imports (after env load) ────────────────────────────────────────────────

import IORedis from 'ioredis';
import { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';

const { prisma } = await import('@bidstack/db');

// ─── Config ──────────────────────────────────────────────────────────────────

const API_URL = process.env.API_URL ?? 'http://localhost:4000';
const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6380';

/** Number of concurrent uploads in the main stress phase. */
const CONCURRENT_UPLOADS = 50;

const RFP_ORCHESTRATE_QUEUE = 'rfp.orchestrate';

// ─── Types ───────────────────────────────────────────────────────────────────

interface UploadResult {
  index: number;
  status: number;
  durationMs: number;
  rfpRequestId: string;
  orchestrationId?: string;
  error?: string;
}

interface Percentiles {
  p50: number;
  p95: number;
  p99: number;
  min: number;
  max: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)]!;
}

function calcPercentiles(durations: number[]): Percentiles {
  const sorted = [...durations].sort((a, b) => a - b);
  return {
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    min: sorted[0] ?? 0,
    max: sorted[sorted.length - 1] ?? 0,
  };
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function formatHttpError(body: unknown, fallback: string): string {
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>;
    const message = record.message ?? record.error;
    if (typeof message === 'string') return message;
  }
  return fallback.slice(0, 500);
}

function pass(label: string) {
  console.log(`  ✅ ${label}`);
}

function fail(label: string) {
  console.error(`  ❌ ${label}`);
  process.exitCode = 1;
}

function section(title: string) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  ${title}`);
  console.log('─'.repeat(60));
}

// ─── Main ────────────────────────────────────────────────────────────────────

const redisOptions = {
  maxRetriesPerRequest: null,
  enableOfflineQueue: false,
  lazyConnect: true,
} as const;

const redis = new IORedis(REDIS_URL, redisOptions);
const queueConnection = new IORedis(REDIS_URL, redisOptions);

const queue = new Queue(RFP_ORCHESTRATE_QUEUE, { connection: queueConnection });

// IDs we create during setup so we can clean them up at the end.
const createdFileAttachmentIds: string[] = [];
const createdJobIds: string[] = [];
const createdRfpRequestIds: string[] = [];
let createdOrgId: string | null = null;

async function main() {
  console.log('\n🚀  BidStack 360° — RFP pipeline load test (W10-P2-1)');
  console.log(`   API: ${API_URL}`);
  console.log(`   Redis: ${REDIS_URL}`);
  console.log(`   Concurrent uploads: ${CONCURRENT_UPLOADS}`);

  // ── PHASE 1: Setup ────────────────────────────────────────────────────────

  section('PHASE 1 — Setup');

  // Verify API is up
  const health = await fetch(`${API_URL}/readyz`).catch(() => null);
  if (!health || !health.ok) {
    fail(`API not reachable at ${API_URL} — start it with: pnpm dev:api`);
    await teardown();
    return;
  }
  pass(`API healthy at ${API_URL}`);

  // Verify Redis is up
  if (redis.status === 'wait') await redis.connect();
  if (queueConnection.status === 'wait') await queueConnection.connect();

  const ping = await redis.ping().catch(() => null);
  if (ping !== 'PONG') {
    fail(`Redis not reachable at ${REDIS_URL}`);
    await teardown();
    return;
  }
  pass(`Redis healthy at ${REDIS_URL}`);

  // Find seed org + opportunity
  const org = await prisma.org.findFirst({
    where: { clerkOrg: 'org_seed_mantu' },
    select: { id: true },
  });
  if (!org) {
    fail('Seed org not found — run: pnpm db:seed');
    await teardown();
    return;
  }

  createdOrgId = org.id;

  const opportunity = await prisma.opportunity.findFirst({
    where: { orgId: org.id, deletedAt: null },
    select: { id: true, customer: true },
  });
  if (!opportunity) {
    fail('No opportunity found for seed org — run: pnpm db:seed');
    await teardown();
    return;
  }
  pass(`Seed org: ${org.id}`);
  pass(`Test opportunity: ${opportunity.id}`);

  // Create FileAttachment rows for both HTTP phases (10 + 50)
  const numAttachments = CONCURRENT_UPLOADS + 10; // extra 10 for rate-limit validation phase
  const accountId = opportunity.customer || 'rfp-load-test';
  const storageAccountPath = accountId.replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 80);
  console.log(`\n  Creating ${numAttachments} test FileAttachment rows...`);

  const attachments = await Promise.all(
    Array.from({ length: numAttachments }, (_, i) =>
      prisma.fileAttachment.create({
        data: {
          orgId: org.id,
          accountId,
          name: `rfp-load-test-${i + 1}.pdf`,
          contentType: 'application/pdf',
          bytes: 1024, // 1 KiB synthetic
          storageKey: `${org.id}/${storageAccountPath}/load-test/rfp-${randomUUID()}.pdf`,
        },
        select: { id: true },
      }),
    ),
  );
  attachments.forEach((a) => createdFileAttachmentIds.push(a.id));
  pass(`Created ${attachments.length} FileAttachment rows`);

  // Reset the rate-limit key so we start clean
  await redis.del(`rfp:upload:${org.id}`);
  pass('Rate-limit key reset');

  // ── PHASE 2: HTTP-10 (all must succeed) ───────────────────────────────────

  section('PHASE 2 — HTTP-10: 10 concurrent uploads (expect all 202)');

  const batch1Attachments = attachments.slice(0, 10);
  const batch1Results = await fireConcurrentUploads(
    opportunity.id,
    batch1Attachments.map((a) => a.id),
  );

  const batch1Success = batch1Results.filter((r) => r.status === 202);
  const batch1Fail = batch1Results.filter((r) => r.status !== 202);

  const p1 = calcPercentiles(batch1Results.map((r) => r.durationMs));
  console.log(`\n  Results: ${batch1Success.length}/10 accepted, ${batch1Fail.length} rejected`);
  console.log(
    `  Latency — p50:${p1.p50}ms  p95:${p1.p95}ms  p99:${p1.p99}ms  min:${p1.min}ms  max:${p1.max}ms`,
  );

  if (batch1Success.length === 10) {
    pass('All 10 uploads accepted (202 Created)');
  } else {
    fail(`Only ${batch1Success.length}/10 uploads accepted — unexpected rejections`);
    batch1Fail.forEach((r) => console.error(`    [${r.index}] HTTP ${r.status}: ${r.error ?? ''}`));
  }

  if (p1.p95 < 2000) {
    pass(`p95 latency ${p1.p95}ms < 2000ms threshold`);
  } else {
    fail(`p95 latency ${p1.p95}ms exceeds 2000ms threshold`);
  }

  // ── PHASE 3: HTTP-50 (rate limiter validation) ────────────────────────────

  section(`PHASE 3 — HTTP-50: ${CONCURRENT_UPLOADS} concurrent uploads (expect 10×202, 40×429)`);

  // Reset the rate-limit key so we start fresh for this phase
  await redis.del(`rfp:upload:${org.id}`);

  const batch2Attachments = attachments.slice(10); // remaining 50
  const batch2Results = await fireConcurrentUploads(
    opportunity.id,
    batch2Attachments.map((a) => a.id),
  );

  const batch2_202 = batch2Results.filter((r) => r.status === 202);
  const batch2_429 = batch2Results.filter((r) => r.status === 429);
  const batch2_other = batch2Results.filter((r) => r.status !== 202 && r.status !== 429);

  const p2 = calcPercentiles(batch2Results.map((r) => r.durationMs));
  console.log(
    `\n  Results: ${batch2_202.length}×202, ${batch2_429.length}×429, ${batch2_other.length} other`,
  );
  console.log(
    `  Latency — p50:${p2.p50}ms  p95:${p2.p95}ms  p99:${p2.p99}ms  min:${p2.min}ms  max:${p2.max}ms`,
  );

  // Allow ±2 due to timing: rate limiter uses Redis INCR which may slightly over-allow
  // at high concurrency (not a bug — fail-open is documented design).
  if (batch2_202.length >= 8 && batch2_202.length <= 12) {
    pass(`Rate limiter accepted ${batch2_202.length} uploads (expected ~10)`);
  } else {
    fail(
      `Rate limiter accepted ${batch2_202.length}/50 — expected ~10 (check rfp:upload:${org.id} Redis key)`,
    );
  }

  if (batch2_429.length >= 38) {
    pass(`Rate limiter blocked ${batch2_429.length} excess uploads (429)`);
  } else {
    fail(
      `Rate limiter only blocked ${batch2_429.length}/50 — ${50 - batch2_429.length - batch2_202.length} fell through`,
    );
  }

  if (batch2_other.length === 0) {
    pass('No unexpected status codes (no 500/404/etc.)');
  } else {
    fail(
      `${batch2_other.length} unexpected responses: ${batch2_other.map((r) => `${r.status}`).join(', ')}`,
    );
  }

  // ── PHASE 4: BullMQ queue depth stress ────────────────────────────────────

  section('PHASE 4 — Queue-50: directly enqueue 50 rfp.orchestrate jobs');

  // Reset the rate-limit key so the 10 from Phase 3 don't count
  await redis.del(`rfp:upload:${org.id}`);

  console.log(`\n  Enqueueing ${CONCURRENT_UPLOADS} jobs directly via BullMQ...`);
  const enqueueStart = Date.now();

  const jobResults = await Promise.allSettled(
    Array.from({ length: CONCURRENT_UPLOADS }, (_) => {
      const rfpRequestId = `load-test-${randomUUID()}`;
      return queue
        .add(
          'rfp.orchestrate',
          {
            orgId: org.id,
            rfpRequestId,
            documentVersionId: randomUUID(), // synthetic — workers will fail to find these rows, which is expected
            opportunityId: opportunity.id,
            startedByUserId: 'load-test-script',
          },
          {
            jobId: `rfp-orch:${org.id}:${rfpRequestId}`,
            // Short TTL so load-test jobs don't accumulate in persistent Redis
            removeOnComplete: { count: 0, age: 60 },
            removeOnFail: { count: 0, age: 60 },
          },
        )
        .then((j) => {
          if (j.id) createdJobIds.push(j.id);
          return j;
        });
    }),
  );

  const enqueueMs = Date.now() - enqueueStart;
  const enqueued = jobResults.filter((r) => r.status === 'fulfilled').length;
  const enqueueFailed = jobResults.filter((r) => r.status === 'rejected').length;

  console.log(`\n  Enqueued ${enqueued}/${CONCURRENT_UPLOADS} jobs in ${enqueueMs}ms`);

  if (enqueued === CONCURRENT_UPLOADS) {
    pass(`All ${CONCURRENT_UPLOADS} jobs enqueued successfully`);
  } else {
    fail(
      `Only ${enqueued}/${CONCURRENT_UPLOADS} jobs enqueued (${enqueueFailed} failed — check Redis connection)`,
    );
  }

  if (enqueueMs < 5000) {
    pass(`Queue ingestion: ${enqueued} jobs in ${enqueueMs}ms (< 5s threshold)`);
  } else {
    fail(`Queue ingestion too slow: ${enqueueMs}ms for ${enqueued} jobs`);
  }

  // ── PHASE 5: Queue depth snapshot ─────────────────────────────────────────

  section('PHASE 5 — Queue depth snapshot');

  const waiting = await queue.getWaiting();
  const active = await queue.getActive();
  const completed = await queue.getCompleted();
  const failed = await queue.getFailed();

  console.log(`\n  Queue state (${RFP_ORCHESTRATE_QUEUE}):`);
  console.log(`    Waiting:   ${waiting.length}`);
  console.log(`    Active:    ${active.length}`);
  console.log(`    Completed: ${completed.length}`);
  console.log(`    Failed:    ${failed.length}`);

  if (waiting.length + active.length > 0) {
    console.log('\n  ℹ️  Jobs in queue — workers may not be running (expected if API-only).');
    console.log('     Start workers with: pnpm dev:worker');
    console.log('     Jobs are configured with removeOnComplete/removeOnFail = 60s TTL.');
    pass('Queue accepted all jobs (drain requires worker process)');
  } else {
    pass('Queue fully drained (workers running)');
  }

  // ── PHASE 6: Summary ──────────────────────────────────────────────────────

  section('PHASE 6 — Summary');
  console.log('');
  console.log(`  Phase 2 (HTTP-10) p95: ${p1.p95}ms`);
  console.log(`  Phase 3 (HTTP-50) p95: ${p2.p95}ms`);
  console.log(`  Phase 4 (Queue ingestion): ${CONCURRENT_UPLOADS} jobs in ${enqueueMs}ms`);
  console.log('');
  console.log(
    `  Exit code: ${process.exitCode === 1 ? '1 (FAILURES — see ❌ above)' : '0 (PASS)'}`,
  );
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

async function fireConcurrentUploads(
  opportunityId: string,
  fileAttachmentIds: string[],
): Promise<UploadResult[]> {
  return Promise.all(
    fileAttachmentIds.map(async (fileAttachmentId, i) => {
      const start = Date.now();
      const rfpRequestId = randomUUID();
      createdRfpRequestIds.push(rfpRequestId);
      try {
        const res = await fetch(`${API_URL}/api/v1/opportunities/${opportunityId}/rfp/upload`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileAttachmentId, rfpRequestId }),
        });
        const durationMs = Date.now() - start;
        let orchestrationId: string | undefined;
        let error: string | undefined;
        try {
          const text = await res.text();
          const body = text ? (JSON.parse(text) as { orchestrationId?: string }) : {};
          orchestrationId = body.orchestrationId;
          if (!res.ok) error = formatHttpError(body, text);
        } catch {
          if (!res.ok) error = 'Unable to parse error response';
        }
        return { index: i, status: res.status, durationMs, rfpRequestId, orchestrationId, error };
      } catch (err) {
        return {
          index: i,
          status: 0,
          durationMs: Date.now() - start,
          rfpRequestId,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }),
  );
}

// ─── Teardown ─────────────────────────────────────────────────────────────────

async function teardown() {
  section('CLEANUP');
  try {
    const fileAttachmentIds = unique(createdFileAttachmentIds);
    const rfpRequestIds = unique(createdRfpRequestIds);
    const orgFilter = createdOrgId ? { orgId: createdOrgId } : {};

    const orchestrationRows =
      rfpRequestIds.length > 0
        ? await prisma.rfpOrchestration.findMany({
            where: { ...orgFilter, rfpRequestId: { in: rfpRequestIds } },
            select: { id: true, documentVersionId: true },
          })
        : [];
    const orchestrationIds = unique(orchestrationRows.map((row) => row.id));
    const orchestrationDocumentVersionIds = unique(
      orchestrationRows.map((row) => row.documentVersionId),
    );

    const documentVersionsByFile =
      fileAttachmentIds.length > 0
        ? await prisma.documentVersion.findMany({
            where: { ...orgFilter, fileAttachmentId: { in: fileAttachmentIds } },
            select: { id: true, bidDocumentId: true },
          })
        : [];
    const documentVersionsByOrchestration =
      orchestrationDocumentVersionIds.length > 0
        ? await prisma.documentVersion.findMany({
            where: { ...orgFilter, id: { in: orchestrationDocumentVersionIds } },
            select: { id: true, bidDocumentId: true },
          })
        : [];
    const documentVersionRows = [...documentVersionsByFile, ...documentVersionsByOrchestration];
    const documentVersionIds = unique([
      ...orchestrationDocumentVersionIds,
      ...documentVersionRows.map((row) => row.id),
    ]);
    const bidDocumentIds = unique(documentVersionRows.map((row) => row.bidDocumentId));

    if (orchestrationIds.length > 0) {
      const auditRows = await prisma.auditLog.deleteMany({
        where: { targetType: 'rfp_orchestration', targetId: { in: orchestrationIds } },
      });
      pass(`Deleted ${auditRows.count} RFP orchestration audit rows`);

      const deleted = await prisma.rfpOrchestration.deleteMany({
        where: { id: { in: orchestrationIds } },
      });
      pass(`Deleted ${deleted.count} RFP orchestration rows`);
    }

    if (documentVersionIds.length > 0) {
      const deleted = await prisma.documentVersion.deleteMany({
        where: { id: { in: documentVersionIds } },
      });
      pass(`Deleted ${deleted.count} DocumentVersion rows`);
    }

    if (bidDocumentIds.length > 0) {
      const deleted = await prisma.bidDocument.deleteMany({
        where: { id: { in: bidDocumentIds } },
      });
      pass(`Deleted ${deleted.count} BidDocument rows`);
    }

    if (fileAttachmentIds.length > 0) {
      const deleted = await prisma.fileAttachment.deleteMany({
        where: { id: { in: fileAttachmentIds } },
      });
      pass(`Deleted ${deleted.count} test FileAttachment rows`);
    }

    // Delete BullMQ test jobs (best-effort — they also have a 60s auto-remove TTL)
    const uploadJobIds =
      createdOrgId === null
        ? []
        : rfpRequestIds.map((rfpRequestId) => `rfp-orch-${createdOrgId}-${rfpRequestId}`);
    const jobIds = unique([...createdJobIds, ...uploadJobIds]);

    if (jobIds.length > 0) {
      const jobs = await Promise.allSettled(
        jobIds.map(async (id) => {
          const job = await queue.getJob(id);
          if (!job) return false;
          await job.remove();
          return true;
        }),
      );
      const removed = jobs.filter((j) => j.status === 'fulfilled' && j.value).length;
      pass(`Removed ${removed} BullMQ test jobs`);
    }
  } catch (err) {
    console.warn('  ⚠️  Cleanup error (non-fatal):', err);
  } finally {
    await prisma.$disconnect();
    await queue.close();
    if (queueConnection.status !== 'end') queueConnection.disconnect();
    redis.disconnect();
  }
}

// ─── Run ──────────────────────────────────────────────────────────────────────

main()
  .then(() => teardown())
  .catch(async (err) => {
    console.error('\n💥 Unhandled error:', err);
    process.exitCode = 1;
    await teardown();
  });
