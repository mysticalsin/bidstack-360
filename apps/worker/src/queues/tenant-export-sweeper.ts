// tenant-export sweeper. Two ways an export row can get stuck:
//  - `pending` with no job: the API enqueue failed (Redis down) after the row
//    was written. The row would wait forever.
//  - `running` with no live worker: the worker died mid-export and BullMQ's
//    stall handling exhausted the job without running our catch block.
// The sweeper re-drives the first kind and fails the second kind once its
// heartbeat (updatedAt, refreshed by the running job) goes stale.

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
/**
 * A running export with no heartbeat for this long counts as abandoned. The
 * worker refreshes updatedAt every minute, and BullMQ retry backoff is at most
 * a few minutes, so a live or retrying export never reaches this.
 */
export const RUNNING_STALE_MS = 15 * 60 * 1000;
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
  const staleWhere = {
    status: 'running' as const,
    deletedAt: null,
    updatedAt: { lt: new Date(now.getTime() - RUNNING_STALE_MS) },
  };
  const pendingWhere = {
    status: 'pending' as const,
    deletedAt: null,
    createdAt: { lt: new Date(now.getTime() - PENDING_GRACE_MS) },
  };
  // TenantExport queries must carry orgId (BIDSTACK_TENANT_SCOPE_GUARD=enforce
  // rejects them otherwise), so find the orgs with stuck rows first; Org itself
  // is not tenant scoped.
  const orgs = await prisma.org.findMany({
    where: { tenantExports: { some: { OR: [staleWhere, pendingWhere] } } },
    select: { id: true },
    orderBy: { id: 'asc' },
    take: SWEEP_BATCH,
  });

  let failed = 0;
  let requeued = 0;
  let budget = SWEEP_BATCH;
  for (const { id: orgId } of orgs) {
    const stale = await prisma.tenantExport.updateMany({
      where: { orgId, ...staleWhere },
      data: {
        status: 'failed',
        error: 'Export stopped reporting progress and was marked failed',
        completedAt: now,
      },
    });
    failed += stale.count;
    if (budget === 0) continue;

    const pending = await prisma.tenantExport.findMany({
      where: { orgId, ...pendingWhere },
      select: { id: true, orgId: true },
      orderBy: { createdAt: 'asc' },
      take: budget,
    });
    budget -= pending.length;
    for (const row of pending) {
      try {
        if (await redrive({ exportId: row.id, orgId: row.orgId })) requeued += 1;
      } catch (err) {
        log.warn({ exportId: row.id, err }, 'tenant-export sweeper: re-enqueue failed');
      }
    }
  }

  if (failed > 0 || requeued > 0) {
    log.warn({ failed, requeued }, 'tenant-export sweeper: recovered stuck exports');
  }
  return { requeued, failed };
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
