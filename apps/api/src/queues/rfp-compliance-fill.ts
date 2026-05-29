// Producer-side handle for the `rfp.compliance-fill` queue.
// One job per compliance matrix row — fan-out from rfp-orchestrator.

import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { createLogger } from '../lib/logger.js';
import { RFP_COMPLIANCE_FILL } from '@bidstack/shared';

const log = createLogger({ name: 'queue:rfp-compliance-fill' });

export const RFP_COMPLIANCE_FILL_QUEUE = RFP_COMPLIANCE_FILL.name;

export interface RfpComplianceFillJob {
  orgId: string;
  orchestrationId: string;
  /** The compliance matrix row / item identifier */
  matrixItemId: string;
  requirementText: string;
  /** Category label from the matrix (e.g. "Security", "SLA", "Pricing") */
  category?: string;
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
    log.error({ err }, 'Redis connection error in rfp-compliance-fill queue');
  });

  queueSingleton = new Queue(RFP_COMPLIANCE_FILL_QUEUE, {
    connection: connectionSingleton,
    defaultJobOptions: RFP_COMPLIANCE_FILL.defaultJobOptions,
  });
  return queueSingleton;
}

/**
 * Enqueue an RFP compliance fill job. Returns the BullMQ job id,
 * or null if Redis is unreachable (fail-open).
 */
export async function enqueueRfpComplianceFill(job: RfpComplianceFillJob): Promise<string | null> {
  if (process.env.NODE_ENV === 'test' && process.env.BIDSTACK_ENABLE_QUEUE_IN_TESTS !== 'true') {
    log.info({ orgId: job.orgId }, 'RFP compliance fill enqueue skipped in test mode');
    return null;
  }
  try {
    const queued = await getQueue().add('rfp.compliance-fill', job, {
      // WHY: dedup key per matrix item — idempotent across orchestrator restarts
      jobId: `rfp-compliance:${job.orchestrationId}:${job.matrixItemId}`,
    });
    log.info(
      { jobId: queued.id, orgId: job.orgId, matrixItemId: job.matrixItemId },
      'RFP compliance fill job enqueued',
    );
    return queued.id ?? null;
  } catch (err) {
    log.error({ err, orgId: job.orgId }, 'Failed to enqueue RFP compliance fill job');
    return null;
  }
}
