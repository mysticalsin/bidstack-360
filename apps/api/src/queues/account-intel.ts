// Producer for the `account-intel` queue. apps/worker runs the job
// (apps/worker/src/queues/account-intel.ts): job boards, company posts,
// filings and registries, each with its own run status.

import { Queue } from 'bullmq';
import IORedis from 'ioredis';

import { ACCOUNT_INTEL, type AccountIntelQueueJob } from '@bidstack/shared';

import { createLogger } from '../lib/logger.js';

const log = createLogger({ name: 'queue:account-intel' });

let queueSingleton: Queue | null = null;
let connectionSingleton: IORedis | null = null;

/** One account refresh request. */
export type AccountIntelRefreshJob = Extract<AccountIntelQueueJob, { kind: 'refresh' }>;
type Enqueue = (job: AccountIntelRefreshJob) => Promise<string | null>;
let enqueueOverride: Enqueue | null = null;

/** Tests capture enqueues instead of talking to Redis. Pass null to reset. */
export function __setAccountIntelEnqueueForTest(fn: Enqueue | null): void {
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
    log.error({ err }, 'Redis connection error in account-intel queue');
  });
  queueSingleton = new Queue(ACCOUNT_INTEL.name, {
    connection: connectionSingleton,
    defaultJobOptions: ACCOUNT_INTEL.defaultJobOptions,
  });
  return queueSingleton;
}

/** Same account and sources within the same minute collapse to one job. */
export function accountIntelJobId(job: AccountIntelRefreshJob, now = Date.now()): string {
  return `${job.orgId}--intel--${job.companyId}--${[...job.sources].sort().join('-')}--${Math.floor(now / 60_000)}`;
}

/** Fail-open: null when Redis is unreachable; the caller reports queued=false. */
export async function enqueueAccountIntel(job: AccountIntelRefreshJob): Promise<string | null> {
  if (enqueueOverride) return enqueueOverride(job);
  if (process.env.NODE_ENV === 'test' && process.env.BIDSTACK_ENABLE_QUEUE_IN_TESTS !== 'true') return null;
  try {
    const queued = await getQueue().add('account-intel.refresh', job, { jobId: accountIntelJobId(job) });
    return queued.id ?? null;
  } catch (err) {
    log.error({ err, orgId: job.orgId, companyId: job.companyId }, 'Failed to enqueue account intel refresh');
    return null;
  }
}
