// Producer-side handle for the `rfp.story-match` queue.
// One job per extracted requirement — fan-out from rfp-orchestrator worker.

import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { createLogger } from '../lib/logger.js';
import { RFP_STORY_MATCH } from '@bidstack/shared';

const log = createLogger({ name: 'queue:rfp-story-match' });

export const RFP_STORY_MATCH_QUEUE = RFP_STORY_MATCH.name;

export interface RfpStoryMatchJob {
  orgId: string;
  orchestrationId: string;
  requirementId: string;
  /** Maximum number of story matches to keep per requirement */
  topK?: number;
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
    log.error({ err }, 'Redis connection error in rfp-story-match queue');
  });

  queueSingleton = new Queue(RFP_STORY_MATCH_QUEUE, {
    connection: connectionSingleton,
    defaultJobOptions: RFP_STORY_MATCH.defaultJobOptions,
  });
  return queueSingleton;
}

/**
 * Enqueue an RFP story match job. Returns the BullMQ job id,
 * or null if Redis is unreachable (fail-open).
 */
export async function enqueueRfpStoryMatch(job: RfpStoryMatchJob): Promise<string | null> {
  if (process.env.NODE_ENV === 'test' && process.env.BIDSTACK_ENABLE_QUEUE_IN_TESTS !== 'true') {
    log.info({ orgId: job.orgId }, 'RFP story match enqueue skipped in test mode');
    return null;
  }
  try {
    const queued = await getQueue().add('rfp.story-match', job, {
      // WHY: dedup key per requirement so parallel orchestrations don't double-match
      jobId: `rfp-story-match:${job.orchestrationId}:${job.requirementId}`,
    });
    log.info(
      { jobId: queued.id, orgId: job.orgId, requirementId: job.requirementId },
      'RFP story match job enqueued',
    );
    return queued.id ?? null;
  } catch (err) {
    log.error({ err, orgId: job.orgId }, 'Failed to enqueue RFP story match job');
    return null;
  }
}
