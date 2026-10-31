// Producer for the `account-enrichment` queue. apps/worker runs the job
// (apps/worker/src/account-enrichment/job.ts): Apollo then Seamless, TTL
// cache, monthly credit budget.

import { Queue } from 'bullmq';
import IORedis from 'ioredis';

import { ACCOUNT_ENRICHMENT, type AccountEnrichmentJob } from '@bidstack/shared';

import { createLogger } from '../lib/logger.js';

const log = createLogger({ name: 'queue:account-enrichment' });

let queueSingleton: Queue | null = null;
let connectionSingleton: IORedis | null = null;

type EnrichJob = Extract<AccountEnrichmentJob, { kind: 'enrich' }>;
type Enqueue = (job: EnrichJob) => Promise<string | null>;
let enqueueOverride: Enqueue | null = null;

/** Tests capture enqueues instead of talking to Redis. Pass null to reset. */
export function __setAccountEnrichmentEnqueueForTest(fn: Enqueue | null): void {
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
    log.error({ err }, 'Redis connection error in account-enrichment queue');
  });
  queueSingleton = new Queue(ACCOUNT_ENRICHMENT.name, {
    connection: connectionSingleton,
    defaultJobOptions: ACCOUNT_ENRICHMENT.defaultJobOptions,
  });
  return queueSingleton;
}

/** Same company within the same minute collapses to one job (double clicks). */
export function accountEnrichmentJobId(job: EnrichJob, now = Date.now()): string {
  return `${job.orgId}--enrich--${job.companyId}--${Math.floor(now / 60_000)}`;
}

/** Fail-open: null when Redis is unreachable; the caller reports queued=false. */
export async function enqueueAccountEnrichment(job: EnrichJob): Promise<string | null> {
  if (enqueueOverride) return enqueueOverride(job);
  if (process.env.NODE_ENV === 'test' && process.env.BIDSTACK_ENABLE_QUEUE_IN_TESTS !== 'true') return null;
  try {
    const queued = await getQueue().add('account-enrichment.enrich', job, { jobId: accountEnrichmentJobId(job) });
    return queued.id ?? null;
  } catch (err) {
    log.error({ err, orgId: job.orgId, companyId: job.companyId }, 'Failed to enqueue account enrichment');
    return null;
  }
}
