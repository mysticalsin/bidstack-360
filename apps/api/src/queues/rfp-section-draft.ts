// Producer-side handle for the `rfp.section-draft` queue.
// One job per proposal section — fan-out from rfp-orchestrator after story matching.

import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { createLogger } from '../lib/logger.js';
import { RFP_SECTION_DRAFT } from '@bidstack/shared';

const log = createLogger({ name: 'queue:rfp-section-draft' });

export const RFP_SECTION_DRAFT_QUEUE = RFP_SECTION_DRAFT.name;

export interface RfpSectionDraftJob {
  orgId: string;
  orchestrationId: string;
  proposalId: string;
  sectionId: string;
  sectionTitle: string;
  /** Requirement IDs whose matched stories should be injected into the draft context */
  requirementIds: string[];
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
    log.error({ err }, 'Redis connection error in rfp-section-draft queue');
  });

  queueSingleton = new Queue(RFP_SECTION_DRAFT_QUEUE, {
    connection: connectionSingleton,
    defaultJobOptions: RFP_SECTION_DRAFT.defaultJobOptions,
  });
  return queueSingleton;
}

/**
 * Enqueue an RFP section draft job. Returns the BullMQ job id,
 * or null if Redis is unreachable (fail-open).
 */
export async function enqueueRfpSectionDraft(job: RfpSectionDraftJob): Promise<string | null> {
  if (process.env.NODE_ENV === 'test' && process.env.BIDSTACK_ENABLE_QUEUE_IN_TESTS !== 'true') {
    log.info({ orgId: job.orgId }, 'RFP section draft enqueue skipped in test mode');
    return null;
  }
  try {
    const queued = await getQueue().add('rfp.section-draft', job, {
      // WHY: dedup key per section prevents duplicate drafts if orchestrator restarts
      jobId: `rfp-section-draft:${job.orchestrationId}:${job.sectionId}`,
    });
    log.info(
      { jobId: queued.id, orgId: job.orgId, sectionId: job.sectionId },
      'RFP section draft job enqueued',
    );
    return queued.id ?? null;
  } catch (err) {
    log.error({ err, orgId: job.orgId }, 'Failed to enqueue RFP section draft job');
    return null;
  }
}
