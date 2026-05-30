// Producer-side handle for the `rfp.embed-reference` queue.
// Enqueued when a success story (reference) is created or updated.
// Worker generates a Cohere embedding and upserts into reference_embeddings.

import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { createLogger } from '../lib/logger.js';
import { RFP_EMBED_REFERENCE } from '@bidstack/shared';

const log = createLogger({ name: 'queue:rfp-embed-reference' });

export const RFP_EMBED_REFERENCE_QUEUE = RFP_EMBED_REFERENCE.name;

export interface RfpEmbedReferenceJob {
  orgId: string;
  /** Success story / reference document ID */
  referenceId: string;
  /** Concatenated text to embed (title + summary + outcome fields) */
  contentText: string;
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
  connectionSingleton.on('error', (err) => {
    log.error({ err }, 'Redis connection error in rfp-embed-reference queue');
  });

  queueSingleton = new Queue(RFP_EMBED_REFERENCE_QUEUE, {
    connection: connectionSingleton,
    defaultJobOptions: RFP_EMBED_REFERENCE.defaultJobOptions,
  });
  return queueSingleton;
}

/**
 * Enqueue an RFP reference embedding job. Returns the BullMQ job id,
 * or null if Redis is unreachable (fail-open).
 */
export async function enqueueRfpEmbedReference(job: RfpEmbedReferenceJob): Promise<string | null> {
  if (process.env.NODE_ENV === 'test' && process.env.BIDSTACK_ENABLE_QUEUE_IN_TESTS !== 'true') {
    log.info({ orgId: job.orgId }, 'RFP embed reference enqueue skipped in test mode');
    return null;
  }
  try {
    const queued = await getQueue().add('rfp.embed-reference', job, {
      // WHY: content-addressed dedup — re-embedding same reference is idempotent
      // but wasteful; jobId ensures the queue holds at most one pending job per ref
      jobId: `rfp-embed-ref-${job.orgId}-${job.referenceId}`,
    });
    log.info(
      { jobId: queued.id, orgId: job.orgId, referenceId: job.referenceId },
      'RFP embed reference job enqueued',
    );
    return queued.id ?? null;
  } catch (err) {
    log.error({ err, orgId: job.orgId }, 'Failed to enqueue RFP embed reference job');
    return null;
  }
}
