// Producer-side handle for the `company-enrich-apollo` queue.
// The actual worker lives in apps/worker. We construct a single Queue
// (lazily) so route handlers can enqueue without owning the full worker
// lifecycle.

import { createHmac } from 'node:crypto';

import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import pino from 'pino';

import { COMPANY_ENRICH_APOLLO } from '@bidstack/shared';

const log = pino({ name: 'queue:apollo-enrich', level: process.env.LOG_LEVEL ?? 'info' });

export const COMPANY_ENRICH_APOLLO_QUEUE = COMPANY_ENRICH_APOLLO.name;

export interface ApolloEnrichJob {
  orgId: string;
  companyName: string;
  domain?: string;
  signature?: string;
}

let queueSingleton: Queue | null = null;
let connectionSingleton: IORedis | null = null;

function getQueue(): Queue {
  if (queueSingleton) return queueSingleton;

  const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6380';
  // The producer connection is dedicated and uses BullMQ-required settings
  // (maxRetriesPerRequest must be null for blocking commands). It's separate
  // from the API's existing health-probe Redis client which has aggressive
  // retry-disabling settings unfit for enqueueing.
  connectionSingleton = new IORedis(redisUrl, {
    maxRetriesPerRequest: null,
    enableOfflineQueue: true,
    lazyConnect: false,
  });
  // Log Redis errors so queue failures are visible in logs/metrics.
  connectionSingleton.on('error', (err) => {
    log.error({ err }, 'Redis connection error in apollo-enrich queue');
  });

  queueSingleton = new Queue(COMPANY_ENRICH_APOLLO_QUEUE, {
    connection: connectionSingleton,
    defaultJobOptions: COMPANY_ENRICH_APOLLO.defaultJobOptions,
  });
  return queueSingleton;
}

function getJobSigningSecret(): string | null {
  return process.env.BIDSTACK_JOB_SIGNING_SECRET ?? process.env.JOB_SIGNING_SECRET ?? null;
}

function canonicalApolloJobPayload(job: Omit<ApolloEnrichJob, 'signature'>): string {
  return JSON.stringify({
    orgId: job.orgId,
    companyName: job.companyName,
    domain: job.domain ?? null,
  });
}

export function createApolloEnrichJobSignature(
  job: Omit<ApolloEnrichJob, 'signature'>,
  secret: string,
): string {
  return createHmac('sha256', secret).update(canonicalApolloJobPayload(job)).digest('hex');
}

/**
 * Enqueue an Apollo data verification job. Returns the BullMQ job id, or null if
 * Redis is unreachable (we swallow the failure so the calling route can still
 * complete the synchronous data verification write).
 */
export async function enqueueApolloEnrich(job: ApolloEnrichJob): Promise<string | null> {
  try {
    const secret = getJobSigningSecret();
    if (!secret && process.env.NODE_ENV === 'production') {
      log.warn('Skipping Apollo enrich enqueue: no JOB_SIGNING_SECRET in production');
      return null;
    }
    const payload = secret
      ? { ...job, signature: createApolloEnrichJobSignature(job, secret) }
      : job;
    const queued = await getQueue().add('apollo.enrich', payload, {
      jobId: `${job.orgId}:${job.companyName}`,
    });
    log.info({ jobId: queued.id, orgId: job.orgId }, 'Apollo enrich job enqueued');
    return queued.id ?? null;
  } catch (err) {
    log.error(
      { err, orgId: job.orgId, companyName: job.companyName },
      'Failed to enqueue Apollo enrich job',
    );
    return null;
  }
}
