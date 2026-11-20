// Consumer for the `account-activity-alerts` queue. apps/worker (mail and
// calendar sync) and apps/mcp-server (activities_ingest) raise one digest per
// account per run; this process owns follower resolution, channel prefs and
// coalescing (services/account-events.service.ts), so the digest is sent here.
// Recipients are Polo users in the org only.
import { Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';

import { ACCOUNT_ACTIVITY_ALERTS, type AccountActivityAlertJob } from '@bidstack/shared';

import { createLogger } from '../lib/logger.js';
import { emitActivitiesAccountEvents } from '../services/account-events.service.js';

const log = createLogger({ name: 'queue:account-activity-alerts' });

let worker: Worker | null = null;
let connectionSingleton: IORedis | null = null;

export async function handleAccountActivityAlertJob(job: AccountActivityAlertJob): Promise<void> {
  if (!job.orgId || !Array.isArray(job.activityIds) || job.activityIds.length === 0) return;
  await emitActivitiesAccountEvents({
    orgId: job.orgId,
    activityIds: job.activityIds,
    actorUserId: job.actorUserId ?? null,
    excludeUserIds: Array.isArray(job.excludeUserIds) ? job.excludeUserIds : [],
  });
}

/** Start the consumer. No-op in tests. */
export async function startAccountActivityAlertsConsumer(): Promise<void> {
  if (worker || process.env.NODE_ENV === 'test') return;
  connectionSingleton = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6380', {
    maxRetriesPerRequest: null,
  });
  connectionSingleton.on('error', (err) =>
    log.error({ err }, 'Redis connection error in account-activity-alerts consumer'),
  );
  worker = new Worker(
    ACCOUNT_ACTIVITY_ALERTS.name,
    (job: Job<AccountActivityAlertJob>) => handleAccountActivityAlertJob(job.data),
    { connection: connectionSingleton, concurrency: 4 },
  );
  worker.on('failed', (job, err) =>
    log.warn({ jobId: job?.id, err: err.message }, 'account activity alert job failed'),
  );
}

export async function stopAccountActivityAlertsConsumer(): Promise<void> {
  const w = worker;
  const connection = connectionSingleton;
  worker = null;
  connectionSingleton = null;
  await w?.close().catch(() => undefined);
  if (connection) await connection.quit().catch(() => connection.disconnect());
}
