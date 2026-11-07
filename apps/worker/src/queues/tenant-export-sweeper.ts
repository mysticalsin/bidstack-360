// tenant-export sweeper. Two ways an export row can get stuck:
//  - `pending` with no job: the API enqueue failed (Redis down) after the row
//    was written. The row would wait forever.
//  - `running` with no live worker: the worker died mid-export and BullMQ's
//    stall handling exhausted the job without running our catch block.
// The sweeper re-drives the first kind and fails the second kind past an SLA.

import type { Queue, Worker } from 'bullmq';
import type IORedis from 'ioredis';
import type pino from 'pino';

import { Queue as BullQueue, Worker as BullWorker } from 'bullmq';
import { prisma } from '@bidstack/db';
import { TENANT_EXPORT } from '@bidstack/shared';

const SWEEPER_QUEUE = 'tenant-export-sweeper';
const SWEEP_EVERY_MS = 5 * 60 * 1000;
/** A pending row younger than this may still be on its way to the queue. */
export const PENDING_GRACE_MS = 10 * 60 * 1000;
/** Longest a healthy export may run before it counts as abandoned. */
export const RUNNING_SLA_MS = 2 * 60 * 60 * 1000;
/** Rows re-enqueued per sweep, so a backlog drains over several sweeps. */
export const SWEEP_BATCH = 100;

export interface SweepResult {
  requeued: number;
  failed: number;
}

/**
 * Re-drive one export. Returns true when a job was created or retried.
 * jobId = exportId, so a plain add is a no-op while a kept job has that id:
 * a failed job (kept 30 days by removeOnFail) must be retried instead, and a
 * waiting or active job is left alone.
 */
export type RedriveExport = (job: { exportId: string; orgId: string }) => Promise<boolean>;

export function makeRedrive(queue: Pick<Queue, 'add' | 'getJob'>): RedriveExport {
  return async (data) => {
    const existing = await queue.getJob(data.exportId);
    if (!existing) {
      await queue.add('tenant.export', data, { jobId: data.exportId });
      return true;
    }
    const state = await existing.getState();
    if (state === 'failed') {
      await existing.retry('failed');
      return true;
    }
    if (state === 'completed') {
      await existing.remove();
      await queue.add('tenant.export', data, { jobId: data.exportId });
      return true;
    }
    return false;
  };
}

export async function sweepTenantExports(
  redrive: RedriveExport,
  log: pino.Logger,
  now: Date = new Date(),
): Promise<SweepResult> {
  const stale = await prisma.tenantExport.updateMany({
    where: {
      status: 'running',
      deletedAt: null,
      startedAt: { lt: new Date(now.getTime() - RUNNING_SLA_MS) },
    },
    data: {
      status: 'failed',
      error: 'Export exceeded the 2-hour limit and was marked failed',
      completedAt: now,
    },
  });

  const pending = await prisma.tenantExport.findMany({
    where: {
      status: 'pending',
      deletedAt: null,
      createdAt: { lt: new Date(now.getTime() - PENDING_GRACE_MS) },
    },
    select: { id: true, orgId: true },
    orderBy: { createdAt: 'asc' },
    take: SWEEP_BATCH,
  });
  let requeued = 0;
  for (const row of pending) {
    try {
      if (await redrive({ exportId: row.id, orgId: row.orgId })) requeued += 1;
    } catch (err) {
      log.warn({ exportId: row.id, err }, 'tenant-export sweeper: re-enqueue failed');
    }
  }

  if (stale.count > 0 || requeued > 0) {
    log.warn({ failed: stale.count, requeued }, 'tenant-export sweeper: recovered stuck exports');
  }
  return { requeued, failed: stale.count };
}

export async function startTenantExportSweeper(
  connection: IORedis,
  log: pino.Logger,
  workers: Worker[],
  queues: Queue[],
): Promise<void> {
  const exportQueue = new BullQueue(TENANT_EXPORT.name, {
    connection,
    defaultJobOptions: TENANT_EXPORT.defaultJobOptions,
  });
  const sweeperQueue = new BullQueue(SWEEPER_QUEUE, { connection });
  queues.push(exportQueue, sweeperQueue);
  await sweeperQueue.add(
    'tenant-export.sweep',
    {},
    {
      repeat: { every: SWEEP_EVERY_MS },
      removeOnComplete: { age: 3600, count: 50 },
      removeOnFail: { age: 86400 },
    },
  );
  const sweepLog = log.child({ kind: 'tenant-export-sweeper' });
  const worker = new BullWorker(
    SWEEPER_QUEUE,
    async () => sweepTenantExports(makeRedrive(exportQueue), sweepLog),
    { connection },
  );
  worker.on('failed', (job, err) =>
    log.error({ jobId: job?.id, err }, 'tenant-export sweeper: failed'),
  );
  workers.push(worker);
  log.info({ queue: SWEEPER_QUEUE }, 'tenant-export sweeper started');
}
