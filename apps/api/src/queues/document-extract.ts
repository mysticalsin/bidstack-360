// Producer-side handle for the `document-extract` queue.
// Route handlers enqueue jobs; the worker in apps/worker performs the actual
// text extraction + LLM call + DB writeback.

import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import pino from 'pino';

import { DOCUMENT_EXTRACT } from '@bidstack/shared';

const log = pino({ name: 'queue:document-extract', level: process.env.LOG_LEVEL ?? 'info' });

export const DOCUMENT_EXTRACT_QUEUE = DOCUMENT_EXTRACT.name;

export interface DocumentExtractJob {
  orgId: string;
  accountId: string;
  documentId: string;
  extractionId: string;
  storageKey: string;
  contentType: string;
  name: string;
  /** Optional custom prompt override. */
  prompt?: string;
}

let queueSingleton: Queue | null = null;
let connectionSingleton: IORedis | null = null;

function getQueue(): Queue {
  if (queueSingleton) return queueSingleton;

  const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6380';
  connectionSingleton = new IORedis(redisUrl, {
    maxRetriesPerRequest: null,
    enableOfflineQueue: true,
    lazyConnect: false,
  });
  // Log Redis errors so queue failures are visible in logs/metrics.
  connectionSingleton.on('error', (err) => {
    log.error({ err }, 'Redis connection error in document-extract queue');
  });

  queueSingleton = new Queue(DOCUMENT_EXTRACT_QUEUE, {
    connection: connectionSingleton,
    defaultJobOptions: DOCUMENT_EXTRACT.defaultJobOptions,
  });
  return queueSingleton;
}

/**
 * Enqueue a document extraction job. Returns the BullMQ job id, or null if
 * Redis is unreachable (fail-open so the API route still responds).
 */
export async function enqueueDocumentExtract(job: DocumentExtractJob): Promise<string | null> {
  try {
    const queued = await getQueue().add('document.extract', job, {
      jobId: `${job.orgId}--${job.documentId}`,
    });
    log.info(
      { jobId: queued.id, orgId: job.orgId, documentId: job.documentId },
      'Document extract job enqueued',
    );
    return queued.id ?? null;
  } catch (err) {
    log.error(
      { err, orgId: job.orgId, documentId: job.documentId },
      'Failed to enqueue document extract job',
    );
    return null;
  }
}
