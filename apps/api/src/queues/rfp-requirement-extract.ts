// Producer-side handle for the `rfp.requirement-extract` queue.
// Route handlers call enqueueRfpRequirementExtract() after rfp.orchestrate
// confirms the document is ready for extraction.

import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { createLogger } from '../lib/logger.js';
import { RFP_REQUIREMENT_EXTRACT } from '@bidstack/shared';

const log = createLogger({ name: 'queue:rfp-requirement-extract' });

export const RFP_REQUIREMENT_EXTRACT_QUEUE = RFP_REQUIREMENT_EXTRACT.name;

export interface RfpRequirementExtractJob {
  orgId: string;
  rfpRequestId: string;
  documentVersionId: string;
  orchestrationId: string;
  /** Chunk index when large documents are split into parallel extract jobs */
  chunkIndex?: number;
  totalChunks?: number;
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
    log.error({ err }, 'Redis connection error in rfp-requirement-extract queue');
  });

  queueSingleton = new Queue(RFP_REQUIREMENT_EXTRACT_QUEUE, {
    connection: connectionSingleton,
    defaultJobOptions: RFP_REQUIREMENT_EXTRACT.defaultJobOptions,
  });
  return queueSingleton;
}

/**
 * Enqueue an RFP requirement extraction job. Returns the BullMQ job id,
 * or null if Redis is unreachable (fail-open so the API route still responds).
 */
export async function enqueueRfpRequirementExtract(
  job: RfpRequirementExtractJob,
): Promise<string | null> {
  if (process.env.NODE_ENV === 'test' && process.env.BIDSTACK_ENABLE_QUEUE_IN_TESTS !== 'true') {
    log.info({ orgId: job.orgId }, 'RFP requirement extract enqueue skipped in test mode');
    return null;
  }
  try {
    const chunkSuffix = job.chunkIndex !== undefined ? `:chunk${job.chunkIndex}` : '';
    const queued = await getQueue().add('rfp.requirement-extract', job, {
      // WHY: dedup key per orchestration+chunk so retries don't create duplicates
      jobId: `rfp-req-extract:${job.orchestrationId}${chunkSuffix}`,
    });
    log.info(
      { jobId: queued.id, orgId: job.orgId, orchestrationId: job.orchestrationId },
      'RFP requirement extract job enqueued',
    );
    return queued.id ?? null;
  } catch (err) {
    log.error({ err, orgId: job.orgId }, 'Failed to enqueue RFP requirement extract job');
    return null;
  }
}
