// Producer-side handle for the `rfp.embed-requirement` queue.
// Enqueued after rfp.requirement-extract creates a new extracted requirement.
// Worker generates a Cohere embedding and upserts into requirement_embeddings.

import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { createLogger } from '../lib/logger.js';
import { RFP_EMBED_REQUIREMENT } from '@bidstack/shared';

const log = createLogger({ name: 'queue:rfp-embed-requirement' });

export const RFP_EMBED_REQUIREMENT_QUEUE = RFP_EMBED_REQUIREMENT.name;

export interface RfpEmbedRequirementJob {
  orgId: string;
  orchestrationId: string;
  requirementId: string;
  /** Requirement text to embed */
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
    log.error({ err }, 'Redis connection error in rfp-embed-requirement queue');
  });

  queueSingleton = new Queue(RFP_EMBED_REQUIREMENT_QUEUE, {
    connection: connectionSingleton,
    defaultJobOptions: RFP_EMBED_REQUIREMENT.defaultJobOptions,
  });
  return queueSingleton;
}

/**
 * Enqueue an RFP requirement embedding job. Returns the BullMQ job id,
 * or null if Redis is unreachable (fail-open).
 */
export async function enqueueRfpEmbedRequirement(
  job: RfpEmbedRequirementJob,
): Promise<string | null> {
  if (process.env.NODE_ENV === 'test' && process.env.BIDSTACK_ENABLE_QUEUE_IN_TESTS !== 'true') {
    log.info({ orgId: job.orgId }, 'RFP embed requirement enqueue skipped in test mode');
    return null;
  }
  try {
    const queued = await getQueue().add('rfp.embed-requirement', job, {
      // WHY: dedup key per requirement — one pending embed job at a time
      jobId: `rfp-embed-req:${job.orgId}:${job.requirementId}`,
    });
    log.info(
      { jobId: queued.id, orgId: job.orgId, requirementId: job.requirementId },
      'RFP embed requirement job enqueued',
    );
    return queued.id ?? null;
  } catch (err) {
    log.error({ err, orgId: job.orgId }, 'Failed to enqueue RFP embed requirement job');
    return null;
  }
}
