// Producer for the `company-tech-detect` queue. apps/worker runs the job
// (apps/worker/src/queues/company-tech-detect.ts): open data technology stack
// for one account, queued when a company is created or imported.

import { Queue } from 'bullmq';
import IORedis from 'ioredis';

import { COMPANY_TECH_DETECT, type CompanyTechDetectQueueJob } from '@bidstack/shared';

import { createLogger } from '../lib/logger.js';

const log = createLogger({ name: 'queue:company-tech-detect' });

let queueSingleton: Queue | null = null;
let connectionSingleton: IORedis | null = null;

export type CompanyTechDetectJob = Extract<CompanyTechDetectQueueJob, { kind: 'refresh' }>;
type Enqueue = (job: CompanyTechDetectJob) => Promise<string | null>;
let enqueueOverride: Enqueue | null = null;

/** Tests capture enqueues instead of talking to Redis. Pass null to reset. */
export function __setCompanyTechDetectEnqueueForTest(fn: Enqueue | null): void {
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
    log.error({ err }, 'Redis connection error in company-tech-detect queue');
  });
  queueSingleton = new Queue(COMPANY_TECH_DETECT.name, {
    connection: connectionSingleton,
    defaultJobOptions: COMPANY_TECH_DETECT.defaultJobOptions,
  });
  return queueSingleton;
}

/** One job per account and hour, so a create followed by an import collapses. */
export function companyTechDetectJobId(job: CompanyTechDetectJob, now = Date.now()): string {
  return `${job.orgId}--tech--${job.companyId}--${Math.floor(now / 3_600_000)}`;
}

/** Fail-open: null when Redis is unreachable or the environment turns open enrichment off. */
export async function enqueueCompanyTechDetect(job: CompanyTechDetectJob): Promise<string | null> {
  if (enqueueOverride) return enqueueOverride(job);
  if (process.env.NODE_ENV === 'test' && process.env.BIDSTACK_ENABLE_QUEUE_IN_TESTS !== 'true') return null;
  if (process.env.BIDSTACK_OPEN_ENRICHMENT_DISABLED === '1') return null;
  try {
    const queued = await getQueue().add('company-tech-detect.refresh', job, { jobId: companyTechDetectJobId(job) });
    return queued.id ?? null;
  } catch (err) {
    log.error({ err, orgId: job.orgId, companyId: job.companyId }, 'Failed to enqueue open tech stack refresh');
    return null;
  }
}

/** Fire and forget for request handlers: never blocks or fails the write that triggered it. */
export function queueCompanyTechDetect(jobs: CompanyTechDetectJob[]): void {
  for (const job of jobs) void enqueueCompanyTechDetect(job);
}
