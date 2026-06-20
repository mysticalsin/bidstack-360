// Producer-side handle for the `tenant-export` queue (GDPR Art. 20).
// The route handler enqueues jobs; the worker in apps/worker streams the
// org's data into a gzipped NDJSON archive and uploads it to storage.

import { Queue } from 'bullmq';
import IORedis from 'ioredis';

import { TENANT_EXPORT, type TenantExportJob } from '@bidstack/shared';

import { createLogger } from '../lib/logger.js';

const log = createLogger({ name: 'queue:tenant-export' });

export const TENANT_EXPORT_QUEUE = TENANT_EXPORT.name;

let queueSingleton: Queue | null = null;
let connectionSingleton: IORedis | null = null;

function getQueue(): Queue {
  if (queueSingleton) return queueSingleton;

  const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6380';
  connectionSingleton = new IORedis(redisUrl, {
    maxRetriesPerRequest: null,
    enableOfflineQueue: true,
    lazyConnect: false,
  });
  connectionSingleton.on('error', (err) => {
    log.error({ err }, 'Redis connection error in tenant-export queue');
  });

  queueSingleton = new Queue(TENANT_EXPORT_QUEUE, {
    connection: connectionSingleton,
    defaultJobOptions: TENANT_EXPORT.defaultJobOptions,
  });
  return queueSingleton;
}

/**
 * Enqueue a tenant-export job. The BullMQ jobId is the exportId so a duplicate
 * enqueue for the same export collapses to one job. Returns the job id, or null
 * if Redis is unreachable (the API row is already persisted; a stuck-export
 * reaper / retry can re-drive it).
 */
export async function enqueueTenantExport(job: TenantExportJob): Promise<string | null> {
  if (process.env.NODE_ENV === 'test' && process.env.BIDSTACK_ENABLE_QUEUE_IN_TESTS !== 'true') {
    log.info({ orgId: job.orgId, exportId: job.exportId }, 'Tenant export enqueue skipped in test');
    return null;
  }
  try {
    const queued = await getQueue().add('tenant.export', job, { jobId: job.exportId });
    log.info({ jobId: queued.id, orgId: job.orgId, exportId: job.exportId }, 'Tenant export enqueued');
    return queued.id ?? null;
  } catch (err) {
    log.error({ err, orgId: job.orgId, exportId: job.exportId }, 'Failed to enqueue tenant export');
    return null;
  }
}

export async function closeTenantExportQueueForTest(): Promise<void> {
  const queue = queueSingleton;
  const connection = connectionSingleton;
  queueSingleton = null;
  connectionSingleton = null;

  await queue?.close().catch(() => undefined);
  if (connection) {
    await connection.quit().catch(() => connection.disconnect());
  }
}
