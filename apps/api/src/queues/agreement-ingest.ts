// Producer and consumer for the `agreement-ingest` queue (slice 13a). The
// AgreementIngestItem row is the durable record; a job only says "look at this
// row" or "run this source sync", so a lost job is recovered by the sweep.
// The consumer runs inside the API process because the intake pipeline
// (extraction, storage, account ranking) lives here.
import { Queue, Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';

import { prisma } from '@bidstack/db';
import { AGREEMENT_INGEST, type AgreementIngestJob } from '@bidstack/shared';

import { createLogger } from '../lib/logger.js';
import { processAgreementIngestItem } from '../services/agreement-ingest/process.js';
import { runAgreementSourceSync } from '../services/agreement-sources/sync.js';
import { addWithinDeadline } from '../lib/queue-enqueue.js';

const log = createLogger({ name: 'queue:agreement-ingest' });

const SWEEP_EVERY_MS = 60_000;
const SWEEP_BATCH = 50;
const MAX_ATTEMPTS = 5;
const PROCESSING_STALE_MS = 10 * 60_000;

let queueSingleton: Queue | null = null;
let connectionSingleton: IORedis | null = null;

type Enqueue = (job: AgreementIngestJob, jobId: string) => Promise<string | null>;
let enqueueOverride: Enqueue | null = null;

/** Tests capture enqueues instead of talking to Redis. Pass null to reset. */
export function __setAgreementIngestEnqueueForTest(fn: Enqueue | null): void {
  enqueueOverride = fn;
}

function redisUrl(): string {
  return process.env.REDIS_URL ?? 'redis://localhost:6380';
}

function getQueue(): Queue {
  if (queueSingleton) return queueSingleton;
  connectionSingleton = new IORedis(redisUrl(), { maxRetriesPerRequest: null, enableOfflineQueue: true });
  connectionSingleton.on('error', (err) => log.error({ err }, 'Redis connection error in agreement-ingest queue'));
  queueSingleton = new Queue(AGREEMENT_INGEST.name, {
    connection: connectionSingleton,
    defaultJobOptions: AGREEMENT_INGEST.defaultJobOptions,
  });
  return queueSingleton;
}

export function ingestJobId(job: AgreementIngestJob): string {
  if (job.kind === 'process') return `process--${job.orgId}--${job.itemId}`;
  if (job.kind === 'sync') return `sync--${job.orgId}--${job.runId}${job.claimId ? `--${job.claimId}` : ''}`;
  return 'sweep';
}

/**
 * Enqueue with a deterministic jobId so retries and double clicks collapse.
 * Fail-open: returns null when Redis is down; the sweep picks queued rows up.
 */
export async function enqueueAgreementIngest(job: AgreementIngestJob): Promise<string | null> {
  const jobId = ingestJobId(job);
  if (enqueueOverride) return enqueueOverride(job, jobId);
  if (process.env.NODE_ENV === 'test' && process.env.BIDSTACK_ENABLE_QUEUE_IN_TESTS !== 'true') return null;
  try {
    const queued = await addWithinDeadline(getQueue(), (q) => q.add(`agreement.${job.kind}`, job, { jobId }));
    return queued.id ?? null;
  } catch (err) {
    log.error({ err, kind: job.kind }, 'Failed to enqueue agreement ingest job');
    return null;
  }
}

/** Re-enqueue rows left queued (Redis outage, MCP-staged items, crashes). */
export async function sweepQueuedAgreementItems(): Promise<number> {
  const stale = new Date(Date.now() - 30_000);
  // A crash mid-process leaves rows in `processing`. REST and MCP rows still
  // hold their bytes or URL, so they go back to the queue; source rows are
  // marked failed so the next sync retries them by id.
  const stuck = new Date(Date.now() - PROCESSING_STALE_MS);
  await prisma.agreementIngestItem.updateMany({
    where: { status: 'processing', updatedAt: { lt: stuck }, sourceId: null },
    data: { status: 'queued' },
  });
  await prisma.agreementIngestItem.updateMany({
    where: { status: 'processing', updatedAt: { lt: stuck }, sourceId: { not: null } },
    data: { status: 'failed', error: 'Interrupted; the next sync retries it', processedAt: new Date(), nextAttemptAt: null },
  });
  const rows = await prisma.agreementIngestItem.findMany({
    where: { status: 'queued', attempts: { lt: MAX_ATTEMPTS }, updatedAt: { lt: stale } },
    orderBy: { createdAt: 'asc' },
    take: SWEEP_BATCH,
    select: { id: true, orgId: true },
  });
  for (const row of rows) {
    await processAgreementIngestItem(row.orgId, row.id).catch((err: unknown) => {
      log.warn({ itemId: row.id, err: err instanceof Error ? err.message : String(err) }, 'sweep item failed');
    });
  }
  await prisma.agreementIngestItem.updateMany({
    where: { status: 'queued', attempts: { gte: MAX_ATTEMPTS } },
    data: { status: 'failed', processedAt: new Date() },
  });
  return rows.length;
}

export async function handleAgreementIngestJob(job: AgreementIngestJob): Promise<unknown> {
  if (job.kind === 'process') return processAgreementIngestItem(job.orgId, job.itemId);
  if (job.kind === 'sync') return runAgreementSourceSync({ orgId: job.orgId, sourceId: job.sourceId, runId: job.runId });
  return sweepQueuedAgreementItems();
}

let worker: Worker | null = null;

/** Start the consumer and the repeatable sweep. No-op in tests or without Redis. */
export async function startAgreementIngestConsumer(): Promise<void> {
  if (worker || process.env.NODE_ENV === 'test') return;
  const connection = new IORedis(redisUrl(), { maxRetriesPerRequest: null });
  connection.on('error', (err) => log.error({ err }, 'Redis connection error in agreement-ingest consumer'));
  worker = new Worker(AGREEMENT_INGEST.name, (job: Job<AgreementIngestJob>) => handleAgreementIngestJob(job.data), {
    connection,
    concurrency: 2,
  });
  worker.on('failed', (job, err) => log.warn({ jobId: job?.id, err: err.message }, 'agreement ingest job failed'));
  await getQueue()
    .add('agreement.sweep', { kind: 'sweep' } satisfies AgreementIngestJob, {
      repeat: { every: SWEEP_EVERY_MS },
      jobId: 'agreement-ingest-sweep',
    })
    .catch((err: unknown) => log.warn({ err }, 'could not schedule agreement ingest sweep'));
}

export async function stopAgreementIngestConsumer(): Promise<void> {
  const w = worker;
  worker = null;
  await w?.close().catch(() => undefined);
  const queue = queueSingleton;
  const connection = connectionSingleton;
  queueSingleton = null;
  connectionSingleton = null;
  await queue?.close().catch(() => undefined);
  if (connection) await connection.quit().catch(() => connection.disconnect());
}
