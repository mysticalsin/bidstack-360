// Producer-side handle for the `document-extract` queue.
// Route handlers enqueue jobs; the worker in apps/worker performs the actual
// text extraction + LLM call + DB writeback.

import { Queue } from 'bullmq';
import IORedis from 'ioredis';

import { DOCUMENT_EXTRACT } from '@bidstack/shared';

export const DOCUMENT_EXTRACT_QUEUE = DOCUMENT_EXTRACT.name;

export interface DocumentExtractJob {
  orgId: string;
  accountId: string;
  documentId: string;
  extractionId: string;
  /** Pre-extracted text sent in the job payload so the worker doesn't need
   *  direct storage access. Capped at ~100k chars to stay within Redis limits. */
  text: string;
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
  connectionSingleton.on('error', () => undefined);

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
    return queued.id ?? null;
  } catch {
    return null;
  }
}
