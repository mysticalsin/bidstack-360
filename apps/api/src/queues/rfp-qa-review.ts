// Producer-side handle for the `rfp.qa-review` queue.
// Enqueued by rfp-orchestrator after proposal compilation completes.

import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { createLogger } from '../lib/logger.js';
import { RFP_QA_REVIEW } from '@bidstack/shared';

const log = createLogger({ name: 'queue:rfp-qa-review' });

export const RFP_QA_REVIEW_QUEUE = RFP_QA_REVIEW.name;

export interface RfpQaReviewJob {
  orgId: string;
  orchestrationId: string;
  proposalId: string;
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
    log.error({ err }, 'Redis connection error in rfp-qa-review queue');
  });

  queueSingleton = new Queue(RFP_QA_REVIEW_QUEUE, {
    connection: connectionSingleton,
    defaultJobOptions: RFP_QA_REVIEW.defaultJobOptions,
  });
  return queueSingleton;
}

/**
 * Enqueue an RFP QA review job. Returns the BullMQ job id,
 * or null if Redis is unreachable (fail-open).
 */
export async function enqueueRfpQaReview(job: RfpQaReviewJob): Promise<string | null> {
  if (process.env.NODE_ENV === 'test' && process.env.BIDSTACK_ENABLE_QUEUE_IN_TESTS !== 'true') {
    log.info({ orgId: job.orgId }, 'RFP QA review enqueue skipped in test mode');
    return null;
  }
  try {
    const queued = await getQueue().add('rfp.qa-review', job, {
      jobId: `rfp-qa-review-${job.orchestrationId}`,
    });
    log.info(
      { jobId: queued.id, orgId: job.orgId, orchestrationId: job.orchestrationId },
      'RFP QA review job enqueued',
    );
    return queued.id ?? null;
  } catch (err) {
    log.error({ err, orgId: job.orgId }, 'Failed to enqueue RFP QA review job');
    return null;
  }
}
