// Producer for the `consulting-partners` queue. apps/worker runs the job
// (apps/worker/src/queues/consulting-partners.ts): public partner sources plus
// a rescan of our own records for one account.

import { Queue } from 'bullmq';
import IORedis from 'ioredis';

import { CONSULTING_PARTNERS, type ConsultingPartnersQueueJob } from '@bidstack/shared';

import { createLogger } from '../lib/logger.js';
import { addWithinDeadline } from '../lib/queue-enqueue.js';

const log = createLogger({ name: 'queue:consulting-partners' });

let queueSingleton: Queue | null = null;
let connectionSingleton: IORedis | null = null;

/** One account refresh request. */
export type ConsultingPartnersRefreshJob = Extract<ConsultingPartnersQueueJob, { kind: 'refresh' }>;
type Enqueue = (job: ConsultingPartnersRefreshJob) => Promise<string | null>;
let enqueueOverride: Enqueue | null = null;

/** Tests capture enqueues instead of talking to Redis. Pass null to reset. */
export function __setConsultingPartnersEnqueueForTest(fn: Enqueue | null): void {
  enqueueOverride = fn;
}

function getQueue(): Queue {
  if (queueSingleton) return queueSingleton;
  connectionSingleton = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6380', {
    maxRetriesPerRequest: null,
    enableOfflineQueue: true,
    lazyConnect: false,
  });
  connectionSingleton.on('error', (err) => {
    log.error({ err }, 'Redis connection error in consulting-partners queue');
  });
  queueSingleton = new Queue(CONSULTING_PARTNERS.name, {
    connection: connectionSingleton,
    defaultJobOptions: CONSULTING_PARTNERS.defaultJobOptions,
  });
  return queueSingleton;
}

/** Fail-open: null when Redis is unreachable; the caller reports queued=false. */
export async function enqueueConsultingPartners(job: ConsultingPartnersRefreshJob): Promise<string | null> {
  if (enqueueOverride) return enqueueOverride(job);
  if (process.env.NODE_ENV === 'test' && process.env.BIDSTACK_ENABLE_QUEUE_IN_TESTS !== 'true') return null;
  try {
    const queued = await addWithinDeadline(getQueue(), (q) => q.add('consulting-partners.refresh', job, { jobId: `${job.orgId}--partners--${job.companyId}--${Date.now()}` }));
    return queued.id ?? null;
  } catch (err) {
    log.error({ err, orgId: job.orgId, companyId: job.companyId }, 'Failed to enqueue consulting partners refresh');
    return null;
  }
}
