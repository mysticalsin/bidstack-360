/**
 * Predictive model retrain queue worker.
 *
 * Queue: predictive.retrain (defined in @bidstack/shared PREDICTIVE_RETRAIN)
 *
 * Job payload: { orgId, entityType } | { all: true } (retrain all orgs/types)
 *
 * Cron schedule: weekly at 02:00 UTC Sunday (registered by worker bootstrap
 * via a BullMQ RepeatableJob — see TODO in worker main.ts).
 *
 * Manual trigger: POST /admin/predictive/retrain → enqueues this job.
 *
 * WHY per-org isolation:
 *   Each job processes exactly one (orgId, entityType) pair. Failures are
 *   isolated: a bad org's data cannot abort another org's training run.
 */

import { Worker, Queue, type Job } from 'bullmq';
import type IORedis from 'ioredis';
import type pino from 'pino';

import { prisma } from '@bidstack/db';
import { PREDICTIVE_RETRAIN } from '@bidstack/shared';

import { trainOrgModel } from '../services/scoring/trainer.js';

// ─── Job payload ──────────────────────────────────────────────────────────

export interface RetrainJobPayload {
  /** Retrain a specific org + entity type. */
  orgId?: string;
  entityType?: 'lead' | 'opportunity';
  /** If true, enumerate all orgs and enqueue individual jobs for each. */
  all?: boolean;
}

// ─── Queue producer (used by API route) ──────────────────────────────────

let queueSingleton: Queue<RetrainJobPayload> | null = null;

export function getRetrainQueue(connection: IORedis): Queue<RetrainJobPayload> {
  if (!queueSingleton) {
    queueSingleton = new Queue<RetrainJobPayload>(PREDICTIVE_RETRAIN.name, {
      connection,
      defaultJobOptions: PREDICTIVE_RETRAIN.defaultJobOptions,
    });
  }
  return queueSingleton;
}

/** Enqueue a retrain job for a specific org/entityType (called by API route). */
export async function enqueueRetrain(
  connection: IORedis,
  orgId: string,
  entityType: 'lead' | 'opportunity',
): Promise<string | undefined> {
  const queue = getRetrainQueue(connection);
  const job = await queue.add(
    `retrain:${orgId}:${entityType}`,
    { orgId, entityType },
    {
      jobId: `retrain-${orgId}-${entityType}-${Date.now()}`,
    },
  );
  return job.id;
}

/** Enqueue a fan-out job that spawns per-org retrains (called by cron). */
export async function enqueueGlobalRetrain(connection: IORedis): Promise<void> {
  const queue = getRetrainQueue(connection);
  await queue.add('retrain:all', { all: true });
}

// ─── Worker ───────────────────────────────────────────────────────────────

export async function startPredictiveRetrainWorker(
  connection: IORedis,
  log: pino.Logger,
  workers: Worker[],
  queues: Queue[],
): Promise<void> {
  const queue = getRetrainQueue(connection);
  queues.push(queue);

  const worker = new Worker<RetrainJobPayload>(
    PREDICTIVE_RETRAIN.name,
    async (job: Job<RetrainJobPayload>) => {
      const childLog = log.child({ jobId: job.id, data: job.data });
      childLog.info('predictive retrain job started');

      if (job.data.all) {
        // Fan-out: enumerate all active orgs and enqueue per-org jobs
        const orgs = await prisma.org.findMany({
          select: { id: true },
          where: { deletedAt: null },
        });
        for (const org of orgs) {
          for (const entityType of ['lead', 'opportunity'] as const) {
            await enqueueRetrain(connection, org.id, entityType);
          }
        }
        childLog.info({ orgCount: orgs.length }, 'fan-out complete');
        return;
      }

      const { orgId, entityType } = job.data;
      if (!orgId || !entityType) {
        childLog.warn('missing orgId or entityType — skipping');
        return;
      }

      const result = await trainOrgModel(orgId, entityType);
      if (result) {
        childLog.info(
          { dbModelId: result.dbModelId, s3Key: result.s3Key, metrics: result.model.metrics },
          'model training complete',
        );
      } else {
        childLog.warn({ orgId, entityType }, 'training returned null — insufficient data');
      }
    },
    {
      connection,
      concurrency: 2, // train at most 2 orgs in parallel
      limiter: { max: 4, duration: 60_000 }, // max 4 training runs per minute
    },
  );

  worker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, err }, 'predictive retrain job failed');
  });

  worker.on('completed', (job) => {
    log.info({ jobId: job.id }, 'predictive retrain job completed');
  });

  workers.push(worker);

  log.info('predictive-retrain worker started');

  // Register weekly repeatable job (cron: every Sunday at 02:00 UTC)
  // TODO(wire-up): This registers the cron on worker startup. If you need to
  // skip a week, remove the repeatable job via Bull Board or queue.removeRepeatable().
  await queue.add(
    'retrain:weekly-cron',
    { all: true },
    {
      repeat: { pattern: '0 2 * * 0' }, // Sundays 02:00 UTC
      jobId: 'predictive-weekly-retrain',
    },
  );

  log.info('predictive retrain weekly cron registered (Sundays 02:00 UTC)');
}
