// Producer-side handle for the `data-subject-request` queue (GDPR Art. 15, 17, 20).
// The route records a DataSubjectRequest row and enqueues its id; the worker in
// apps/worker runs it through the shared engine in @bidstack/db.

import { Queue } from 'bullmq';
import IORedis from 'ioredis';

import { DATA_SUBJECT_REQUEST, type DataSubjectJob } from '@bidstack/shared';

import { createLogger } from '../lib/logger.js';
import { addWithinDeadline } from '../lib/queue-enqueue.js';

const log = createLogger({ name: 'queue:data-subject-request' });

let queueSingleton: Queue | null = null;
let connectionSingleton: IORedis | null = null;

function getQueue(): Queue {
  if (queueSingleton) return queueSingleton;
  connectionSingleton = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6380', {
    maxRetriesPerRequest: null,
    enableOfflineQueue: true,
    lazyConnect: false,
  });
  connectionSingleton.on('error', (err) => {
    log.error({ err }, 'Redis connection error in data-subject-request queue');
  });
  queueSingleton = new Queue(DATA_SUBJECT_REQUEST.name, {
    connection: connectionSingleton,
    defaultJobOptions: DATA_SUBJECT_REQUEST.defaultJobOptions,
  });
  return queueSingleton;
}

/**
 * Enqueue a request. The jobId is the request id, so a duplicate enqueue
 * collapses to one job. Returns null when Redis is unreachable; the row stays
 * `queued` for a retry to drive.
 */
export async function enqueueDataSubjectRequest(job: DataSubjectJob): Promise<string | null> {
  if (process.env.NODE_ENV === 'test' && process.env.BIDSTACK_ENABLE_QUEUE_IN_TESTS !== 'true') {
    log.info({ requestId: job.requestId }, 'Data subject request enqueue skipped in test');
    return null;
  }
  try {
    const queued = await addWithinDeadline(getQueue(), (q) => q.add('data-subject.run', job, { jobId: job.requestId }));
    return queued.id ?? null;
  } catch (err) {
    log.error({ err, requestId: job.requestId }, 'Failed to enqueue data subject request');
    return null;
  }
}

export async function closeDataSubjectQueueForTest(): Promise<void> {
  const queue = queueSingleton;
  const connection = connectionSingleton;
  queueSingleton = null;
  connectionSingleton = null;
  await queue?.close().catch(() => undefined);
  if (connection) await connection.quit().catch(() => connection.disconnect());
}
