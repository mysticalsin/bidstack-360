// Producer-side handle for the `rfp.legal-scan` queue.
// Enqueued by rfp-orchestrator after all section drafts complete.

import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { createLogger } from '../lib/logger.js';
import { RFP_LEGAL_SCAN } from '@bidstack/shared';

const log = createLogger({ name: 'queue:rfp-legal-scan' });

export const RFP_LEGAL_SCAN_QUEUE = RFP_LEGAL_SCAN.name;

export interface RfpLegalScanJob {
  orgId: string;
  orchestrationId: string;
  documentVersionId: string;
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
    log.error({ err }, 'Redis connection error in rfp-legal-scan queue');
  });

  queueSingleton = new Queue(RFP_LEGAL_SCAN_QUEUE, {
    connection: connectionSingleton,
    defaultJobOptions: RFP_LEGAL_SCAN.defaultJobOptions,
  });
  return queueSingleton;
}

/**
 * Enqueue an RFP legal scan job. Returns the BullMQ job id,
 * or null if Redis is unreachable (fail-open).
 */
export async function enqueueRfpLegalScan(job: RfpLegalScanJob): Promise<string | null> {
  if (process.env.NODE_ENV === 'test' && process.env.BIDSTACK_ENABLE_QUEUE_IN_TESTS !== 'true') {
    log.info({ orgId: job.orgId }, 'RFP legal scan enqueue skipped in test mode');
    return null;
  }
  try {
    const queued = await getQueue().add('rfp.legal-scan', job, {
      jobId: `rfp-legal-scan-${job.orchestrationId}`,
    });
    log.info(
      { jobId: queued.id, orgId: job.orgId, orchestrationId: job.orchestrationId },
      'RFP legal scan job enqueued',
    );
    return queued.id ?? null;
  } catch (err) {
    log.error({ err, orgId: job.orgId }, 'Failed to enqueue RFP legal scan job');
    return null;
  }
}
