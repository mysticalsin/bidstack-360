// Producer-side handle for the `dust-poll` queue.
// The actual worker (cron-style poll + Dust API calls) lives in
// apps/worker/src/queues/dust-poll.ts. Route handlers use this thin enqueue
// helper to trigger an out-of-cycle pull (e.g. the "Resync now" button on
// the Integrations page).
//
// We keep a single Queue + IORedis singleton per process to avoid the
// "too many connections" anti-pattern in dev with HMR. Failure to reach
// Redis is swallowed and the helper returns null — the caller's API
// response still succeeds, the user just sees the existing schedule.

import { Queue } from 'bullmq';
import IORedis from 'ioredis';

import { DUST_POLL } from '@bidstack/shared';

export const DUST_POLL_QUEUE = DUST_POLL.name;

let queueSingleton: Queue | null = null;
let connectionSingleton: IORedis | null = null;

function getQueue(): Queue {
  if (queueSingleton) return queueSingleton;

  const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6380';
  // BullMQ requires `maxRetriesPerRequest: null` for blocking commands; this
  // dedicated connection is separate from the API's health-probe Redis client
  // which has aggressive retry-disabling settings unfit for enqueueing.
  connectionSingleton = new IORedis(redisUrl, {
    maxRetriesPerRequest: null,
    enableOfflineQueue: true,
    lazyConnect: false,
  });
  // Swallow listener-less errors so an unreachable Redis doesn't crash the API.
  connectionSingleton.on('error', () => undefined);

  queueSingleton = new Queue(DUST_POLL_QUEUE, {
    connection: connectionSingleton,
    defaultJobOptions: DUST_POLL.defaultJobOptions,
  });
  return queueSingleton;
}

export interface DustPollJob {
  source: 'manual' | 'scheduled' | 'webhook';
  orgId: string;
}

/**
 * Enqueue an immediate Dust poll. Returns the BullMQ job id, or null if
 * Redis is unreachable. The worker reads the same job shape that the
 * scheduled tick uses ({ source }) plus a synthetic orgId field that the
 * worker ignores today but will surface in audit logs once per-org polling
 * lands.
 */
export async function enqueueDustResync(job: DustPollJob): Promise<string | null> {
  try {
    const queued = await getQueue().add('dust.poll', job, {
      // Per-org dedup window: at most one manual resync queued at a time.
      jobId: `${job.orgId}:manual:${Math.floor(Date.now() / 30_000)}`,
    });
    return queued.id ?? null;
  } catch {
    return null;
  }
}
