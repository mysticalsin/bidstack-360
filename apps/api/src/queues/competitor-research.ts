// Producer-side handle for the `competitor.research` queue.
// One job per (competitorProfile [, opportunity]).

import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { createLogger } from '../lib/logger.js';
import { COMPETITOR_RESEARCH } from '@bidstack/shared';

const log = createLogger({ name: 'queue:competitor-research' });

export const COMPETITOR_RESEARCH_QUEUE = COMPETITOR_RESEARCH.name;

export interface CompetitorResearchJob {
  orgId: string;
  competitorProfileId: string;
  opportunityId?: string | null;
  /** Optional caller-supplied public URLs to ground on, in addition to search. */
  seedUrls?: string[];
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
    log.error({ err }, 'Redis connection error in competitor-research queue');
  });

  queueSingleton = new Queue(COMPETITOR_RESEARCH_QUEUE, {
    connection: connectionSingleton,
    defaultJobOptions: COMPETITOR_RESEARCH.defaultJobOptions,
  });
  return queueSingleton;
}

/**
 * Enqueue a competitor research job. Returns the BullMQ job id, or null if
 * Redis is unreachable / in test mode (fail-open — the caller gets a 202 only
 * when a job id is returned).
 */
export async function enqueueCompetitorResearch(
  job: CompetitorResearchJob,
): Promise<string | null> {
  if (process.env.NODE_ENV === 'test' && process.env.BIDSTACK_ENABLE_QUEUE_IN_TESTS !== 'true') {
    log.info({ orgId: job.orgId }, 'competitor research enqueue skipped in test mode');
    return null;
  }
  try {
    const enqueued = await getQueue().add('competitor.research', job, {
      jobId: `competitor-research-${job.competitorProfileId}-${job.opportunityId ?? 'profile'}`,
    });
    return enqueued.id ?? null;
  } catch (err) {
    log.error({ err, orgId: job.orgId }, 'Failed to enqueue competitor research job');
    return null;
  }
}
