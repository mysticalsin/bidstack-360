// Producer for the `msa-text-extract` queue. The finalize route enqueues one
// job per new MSA file version; apps/worker extracts the text and stores it on
// contract_file_versions for full-text search.

import { Queue } from 'bullmq';
import IORedis from 'ioredis';

import { MSA_TEXT_EXTRACT, type MsaTextExtractJob } from '@bidstack/shared';

import { createLogger } from '../lib/logger.js';

const log = createLogger({ name: 'queue:msa-text-extract' });

let queueSingleton: Queue | null = null;
let connectionSingleton: IORedis | null = null;

type Enqueue = (job: MsaTextExtractJob) => Promise<string | null>;
let enqueueOverride: Enqueue | null = null;

/** Tests capture enqueues instead of talking to Redis. Pass null to reset. */
export function __setMsaTextExtractEnqueueForTest(fn: Enqueue | null): void {
  enqueueOverride = fn;
}

function getQueue(): Queue {
  if (queueSingleton) return queueSingleton;
  connectionSingleton = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6380', {
    maxRetriesPerRequest: null,
    enableOfflineQueue: true,
    lazyConnect: false,
  });
  connectionSingleton.on('error', (err) => {
    log.error({ err }, 'Redis connection error in msa-text-extract queue');
  });
  queueSingleton = new Queue(MSA_TEXT_EXTRACT.name, {
    connection: connectionSingleton,
    defaultJobOptions: MSA_TEXT_EXTRACT.defaultJobOptions,
  });
  return queueSingleton;
}

/**
 * Enqueue text extraction for one version. Fail-open: returns null when Redis
 * is unreachable (the version stays `pending` and can be re-enqueued).
 */
export async function enqueueMsaTextExtract(job: MsaTextExtractJob): Promise<string | null> {
  if (enqueueOverride) return enqueueOverride(job);
  if (process.env.NODE_ENV === 'test' && process.env.BIDSTACK_ENABLE_QUEUE_IN_TESTS !== 'true') {
    return null;
  }
  try {
    const queued = await getQueue().add('msa.text-extract', job, {
      jobId: `${job.orgId}--${job.versionId}--${Date.now()}`,
    });
    return queued.id ?? null;
  } catch (err) {
    log.error({ err, orgId: job.orgId, versionId: job.versionId }, 'Failed to enqueue MSA text extract');
    return null;
  }
}

export async function closeMsaTextExtractQueueForTest(): Promise<void> {
  const queue = queueSingleton;
  const connection = connectionSingleton;
  queueSingleton = null;
  connectionSingleton = null;
  await queue?.close().catch(() => undefined);
  if (connection) await connection.quit().catch(() => connection.disconnect());
}
