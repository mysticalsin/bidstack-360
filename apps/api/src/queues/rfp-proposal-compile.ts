// Producer-side handle for the `rfp.proposal-compile` queue.
// Enqueued by rfp-orchestrator after legal scan completes (or is configured to skip).

import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { createLogger } from '../lib/logger.js';
import { RFP_PROPOSAL_COMPILE } from '@bidstack/shared';

const log = createLogger({ name: 'queue:rfp-proposal-compile' });

export const RFP_PROPOSAL_COMPILE_QUEUE = 'rfp.proposal-compile';

export interface RfpProposalCompileJob {
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
    log.error({ err }, 'Redis connection error in rfp-proposal-compile queue');
  });

  queueSingleton = new Queue(RFP_PROPOSAL_COMPILE_QUEUE, {
    connection: connectionSingleton,
    defaultJobOptions: RFP_PROPOSAL_COMPILE.defaultJobOptions,
  });
  return queueSingleton;
}

/**
 * Enqueue an RFP proposal compilation job. Returns the BullMQ job id,
 * or null if Redis is unreachable (fail-open).
 */
export async function enqueueRfpProposalCompile(
  job: RfpProposalCompileJob,
): Promise<string | null> {
  if (process.env.NODE_ENV === 'test' && process.env.BIDSTACK_ENABLE_QUEUE_IN_TESTS !== 'true') {
    log.info({ orgId: job.orgId }, 'RFP proposal compile enqueue skipped in test mode');
    return null;
  }
  try {
    const queued = await getQueue().add('rfp.proposal-compile', job, {
      jobId: `rfp-proposal-compile-${job.orchestrationId}`,
    });
    log.info(
      { jobId: queued.id, orgId: job.orgId, orchestrationId: job.orchestrationId },
      'RFP proposal compile job enqueued',
    );
    return queued.id ?? null;
  } catch (err) {
    log.error({ err, orgId: job.orgId }, 'Failed to enqueue RFP proposal compile job');
    return null;
  }
}
