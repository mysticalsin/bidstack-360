// Producer-side handle for the `rfp.orchestrate` queue.
// Route handlers call enqueueRfpOrchestrate() to kick off the full RFP
// automation pipeline. The actual DAG launch lives in apps/worker.

import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { createLogger } from '../lib/logger.js';
import { RFP_ORCHESTRATE } from '@bidstack/shared';

const log = createLogger({ name: 'queue:rfp-orchestrate' });

export const RFP_ORCHESTRATE_QUEUE = RFP_ORCHESTRATE.name;

export interface RfpOrchestrateJob {
  orgId: string;
  rfpRequestId: string;
  documentVersionId: string;
  opportunityId?: string;
  proposalId?: string;
  startedByUserId?: string;
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
    log.error({ err }, 'Redis connection error in rfp-orchestrate queue');
  });

  queueSingleton = new Queue(RFP_ORCHESTRATE_QUEUE, {
    connection: connectionSingleton,
    defaultJobOptions: RFP_ORCHESTRATE.defaultJobOptions,
  });
  return queueSingleton;
}

/**
 * Enqueue an RFP orchestration job. Returns the BullMQ job id, or null if
 * Redis is unreachable (fail-open so the API route still responds).
 */
export async function enqueueRfpOrchestrate(job: RfpOrchestrateJob): Promise<string | null> {
  if (process.env.NODE_ENV === 'test' && process.env.BIDSTACK_ENABLE_QUEUE_IN_TESTS !== 'true') {
    log.info(
      { orgId: job.orgId, rfpRequestId: job.rfpRequestId },
      'RFP orchestrate enqueue skipped in test mode',
    );
    return null;
  }
  try {
    const queued = await getQueue().add('rfp.orchestrate', job, {
      // WHY: dedup key per org+rfpRequest so duplicate uploads don't double-launch
      jobId: `rfp-orch-${job.orgId}-${job.rfpRequestId}`,
    });
    log.info(
      { jobId: queued.id, orgId: job.orgId, rfpRequestId: job.rfpRequestId },
      'RFP orchestrate job enqueued',
    );
    return queued.id ?? null;
  } catch (err) {
    log.error(
      { err, orgId: job.orgId, rfpRequestId: job.rfpRequestId },
      'Failed to enqueue RFP orchestrate job',
    );
    return null;
  }
}
