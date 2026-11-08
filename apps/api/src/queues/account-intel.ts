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
/** Every public source plus Apollo organization data for one company (slice 14). */
export type CompanyFullRefreshJob = Extract<AccountIntelQueueJob, { kind: 'full-refresh' }>;
type Enqueue = (job: AccountIntelRefreshJob | CompanyFullRefreshJob) => Promise<string | null>;
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

/** Unique per request: a reused id would be ignored by BullMQ once the earlier job completed. */
export function accountIntelJobId(job: AccountIntelRefreshJob, now = Date.now()): string {
  return `${job.orgId}--intel--${job.companyId}--${[...job.sources].sort().join('-')}--${now}`;
}

/** Sources pulled once for a new account: registry first, so filings can use the LEI it finds. */
export const FIRST_RUN_SOURCES: AccountIntelRefreshJob['sources'] = ['registry', 'financials'];

type IntelRunDb = { intelSourceRun: { createMany(args: { data: Array<{ orgId: string; companyId: string; source: string; status: string }>; skipDuplicates?: boolean }): Promise<unknown> } };

/**
 * First registry and filings pull for a newly created account. The worker's
 * scoped filings run ignores the Standard tier pause, so this one run happens
 * for every account. Never throws: account creation must not depend on Redis.
 */
export async function queueFirstAccountIntel(db: IntelRunDb, input: { orgId: string; companyId: string; requestedBy: string | null }): Promise<string | null> {
  try {
    const jobId = await enqueueAccountIntel({ kind: 'refresh', ...input, sources: [...FIRST_RUN_SOURCES] });
    if (jobId) {
      await db.intelSourceRun.createMany({
        data: FIRST_RUN_SOURCES.map((source) => ({ orgId: input.orgId, companyId: input.companyId, source, status: 'queued' })),
        skipDuplicates: true,
      });
    }
    return jobId;
  } catch (err) {
    log.warn({ err, orgId: input.orgId, companyId: input.companyId }, 'First account intel run was not queued');
    return null;
  }
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

/** One full refresh per company and minute, so double clicks collapse. */
export function companyFullRefreshJobId(job: CompanyFullRefreshJob, now = Date.now()): string {
  return `${job.orgId}--intel-full--${job.companyId}--${Math.floor(now / 60_000)}`;
}

/** Fail-open like enqueueAccountIntel. */
export async function enqueueCompanyFullRefresh(job: CompanyFullRefreshJob): Promise<string | null> {
  if (enqueueOverride) return enqueueOverride(job);
  if (process.env.NODE_ENV === 'test' && process.env.BIDSTACK_ENABLE_QUEUE_IN_TESTS !== 'true') return null;
  try {
    const queued = await getQueue().add('account-intel.full-refresh', job, { jobId: companyFullRefreshJobId(job) });
    return queued.id ?? null;
  } catch (err) {
    log.error({ err, orgId: job.orgId, companyId: job.companyId }, 'Failed to enqueue company intel full refresh');
    return null;
  }
}
