// Producer-side handle for the `company-enrich-apollo` queue.
// The actual worker lives in apps/worker. We construct a single Queue
// (lazily) so route handlers can enqueue without owning the full worker
// lifecycle.

import { createHmac } from 'node:crypto';

import { Queue } from 'bullmq';
import IORedis from 'ioredis';

import { COMPANY_ENRICH_APOLLO } from '@bidstack/shared';

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

  const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
  // The producer connection is dedicated and uses BullMQ-required settings
  // (maxRetriesPerRequest must be null for blocking commands). It's separate
  // from the API's existing health-probe Redis client which has aggressive
  // retry-disabling settings unfit for enqueueing.
  connectionSingleton = new IORedis(redisUrl, {
    maxRetriesPerRequest: null,
    enableOfflineQueue: true,
    lazyConnect: false,
  });
  // Swallow listener-less errors so an unreachable Redis doesn't crash the API.
  connectionSingleton.on('error', () => undefined);

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
 * Enqueue an Apollo enrichment job. Returns the BullMQ job id, or null if
 * Redis is unreachable (we swallow the failure so the calling route can still
 * complete the synchronous enrichment write).
 */
export async function enqueueApolloEnrich(job: ApolloEnrichJob): Promise<string | null> {
  try {
    const secret = getJobSigningSecret();
    if (!secret && process.env.NODE_ENV === 'production') return null;
    const payload = secret
      ? { ...job, signature: createApolloEnrichJobSignature(job, secret) }
      : job;
    const queued = await getQueue().add('apollo.enrich', payload, {
      jobId: `${job.orgId}:${job.companyName}`,
    });
    return queued.id ?? null;
  } catch {
    return null;
  }
}
