import { randomUUID } from 'node:crypto';

import { Queue } from 'bullmq';
import IORedis from 'ioredis';

import { SENTRY_SMOKE } from '@bidstack/shared';

import { createLogger } from '../lib/logger.js';

const log = createLogger({ name: 'queue:sentry-smoke' });

export const SENTRY_SMOKE_QUEUE = SENTRY_SMOKE.name;

export interface SentrySmokeJob {
  marker: string;
  release: string;
  environment: string;
  triggeredAt: string;
}

let queueSingleton: Queue<SentrySmokeJob> | null = null;
let connectionSingleton: IORedis | null = null;

function getQueue(): Queue<SentrySmokeJob> {
  if (queueSingleton) return queueSingleton;

  const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6380';
  connectionSingleton = new IORedis(redisUrl, {
    maxRetriesPerRequest: null,
    enableOfflineQueue: true,
    lazyConnect: false,
  });
  connectionSingleton.on('error', (err) => {
    log.error({ err }, 'Redis connection error in sentry-smoke queue');
  });

  queueSingleton = new Queue<SentrySmokeJob>(SENTRY_SMOKE_QUEUE, {
    connection: connectionSingleton,
    defaultJobOptions: SENTRY_SMOKE.defaultJobOptions,
  });
  return queueSingleton;
}

export async function enqueueSentrySmoke(job: SentrySmokeJob): Promise<string | null> {
  if (process.env.NODE_ENV === 'test' && process.env.BIDSTACK_ENABLE_QUEUE_IN_TESTS !== 'true') {
    log.info({ marker: job.marker }, 'Sentry smoke enqueue skipped in test mode');
    return null;
  }

  try {
    const queued = await getQueue().add('sentry.smoke', job, {
      jobId: `sentry-smoke-${randomUUID()}`,
    });
    log.info({ jobId: queued.id, marker: job.marker }, 'Sentry smoke job enqueued');
    return queued.id ?? null;
  } catch (err) {
    log.error({ err, marker: job.marker }, 'Failed to enqueue sentry-smoke job');
    return null;
  }
}

export async function closeSentrySmokeQueueForTest(): Promise<void> {
  const queue = queueSingleton;
  const connection = connectionSingleton;
  queueSingleton = null;
  connectionSingleton = null;

  await queue?.close().catch(() => undefined);
  if (connection) {
    await connection.quit().catch(() => connection.disconnect());
  }
}
