// Producer-side handle for the `crew-run` queue. The API enqueues a run after
// creating the CrewRun row; the worker executes the crew via kickoff() and
// writes the result back.

import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { createLogger } from '../lib/logger.js';
import { CREW_RUN } from '@bidstack/shared';

const log = createLogger({ name: 'queue:crew-run' });

export const CREW_RUN_QUEUE = CREW_RUN.name;

export interface CrewRunJob {
  orgId: string;
  crewId: string;
  runId: string;
  inputs: Record<string, string>;
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
    log.error({ err }, 'Redis connection error in crew-run queue');
  });
  queueSingleton = new Queue(CREW_RUN_QUEUE, {
    connection: connectionSingleton,
    defaultJobOptions: CREW_RUN.defaultJobOptions,
  });
  return queueSingleton;
}

/**
 * Enqueue a crew run. Returns the BullMQ job id, or null if Redis is
 * unreachable (fail-open so the API still responds; the run stays 'queued').
 */
export async function enqueueCrewRun(job: CrewRunJob): Promise<string | null> {
  if (process.env.NODE_ENV === 'test' && process.env.BIDSTACK_ENABLE_QUEUE_IN_TESTS !== 'true') {
    log.info({ orgId: job.orgId, runId: job.runId }, 'crew-run enqueue skipped in test mode');
    return null;
  }
  try {
    const queued = await getQueue().add('crew.run', job, { jobId: `crew-run-${job.runId}` });
    log.info({ jobId: queued.id, orgId: job.orgId, runId: job.runId }, 'crew-run job enqueued');
    return queued.id ?? null;
  } catch (err) {
    log.error({ err, orgId: job.orgId, runId: job.runId }, 'Failed to enqueue crew-run job');
    return null;
  }
}
