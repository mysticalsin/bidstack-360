/**
 * Workflow schedule worker.
 *
 * Queue: workflow.schedule (WORKFLOW_SCHEDULE in @bidstack/shared)
 *
 * A repeatable job (every 15 min) scans active, non-deleted workflows with
 * triggerKind 'schedule' and runs the DUE ones through the shared engine,
 * writing one WorkflowRun row each. "Due" honours an optional
 * `triggerConfig.everyMinutes` cadence; absent that, a workflow runs once per
 * scan interval (i.e. lastRunAt older than the interval).
 *
 * WHY a repeatable scan, not a per-workflow cron: schedule workflows are rare
 * and low-frequency. One periodic scan avoids registering/unregistering N Bull
 * repeatables as workflows are created/edited/deleted.
 */

import { Queue, Worker, type Job } from 'bullmq';
import type IORedis from 'ioredis';
import type pino from 'pino';

import { prisma, type Prisma } from '@bidstack/db';
import {
  WORKFLOW_SCHEDULE,
  runWorkflowActions,
  type WorkflowActionKind,
} from '@bidstack/shared';

import { buildWorkflowEffects } from '../services/workflow-effects.js';
import type { WebhookDeliveryQueue } from './webhook-delivery.js';

const QUEUE_NAME = WORKFLOW_SCHEDULE.name;

/** Fixed scan interval in minutes. Kept conservative (see WORKFLOW_SCHEDULE). */
const SCAN_INTERVAL_MINUTES = 15;

/**
 * Upper bound on schedule workflows examined per scan. Keeps one scan's memory
 * and DB load bounded if a tenant ever accumulates many schedule workflows;
 * a deterministic order means the same set is paged consistently scan-to-scan.
 */
const SCAN_BATCH_SIZE = 500;

/**
 * A schedule workflow is due when it has never run, or its last run is older
 * than its cadence. Cadence = `triggerConfig.everyMinutes` (clamped to >= the
 * scan interval so we never busy-loop), defaulting to the scan interval.
 */
function isDue(
  triggerConfig: Record<string, unknown>,
  lastRunAt: Date | null,
  now: Date,
): boolean {
  if (!lastRunAt) return true;
  const raw = triggerConfig.everyMinutes;
  const everyMinutes =
    typeof raw === 'number' && Number.isFinite(raw) && raw > 0
      ? Math.max(raw, SCAN_INTERVAL_MINUTES)
      : SCAN_INTERVAL_MINUTES;
  const elapsedMs = now.getTime() - lastRunAt.getTime();
  return elapsedMs >= everyMinutes * 60_000;
}

/**
 * Atomically claim a schedule run. Compare-and-swap on the `lastRunAt` we
 * observed: only one scan whose WHERE still matches the observed value wins the
 * updateMany (count === 1); a concurrent/overlapping scan that already advanced
 * lastRunAt sees count === 0 and skips. Prevents a double-run when scans overlap.
 */
async function claimScheduleRun(
  workflowId: string,
  orgId: string,
  observedLastRunAt: Date | null,
  now: Date,
): Promise<boolean> {
  const { count } = await prisma.workflow.updateMany({
    where: { id: workflowId, orgId, lastRunAt: observedLastRunAt },
    data: { lastRunAt: now },
  });
  return count === 1;
}

/**
 * Best-effort transition a stuck 'running' run to 'failed'. Org-scoped and never
 * throws — last-resort cleanup after the completion path failed, so a second DB
 * error here must not mask the original one.
 */
async function markRunFailed(
  runId: string,
  orgId: string,
  cause: unknown,
  log: pino.Logger,
): Promise<void> {
  const message = cause instanceof Error ? cause.message : String(cause);
  try {
    await prisma.workflowRun.updateMany({
      where: { id: runId, orgId, status: 'running' },
      data: { status: 'failed', error: message, finishedAt: new Date() },
    });
  } catch (cleanupErr) {
    log.error({ err: cleanupErr, runId }, 'failed to mark stuck scheduled run as failed');
  }
}

async function runDueSchedules(
  webhookQueue: WebhookDeliveryQueue,
  log: pino.Logger,
): Promise<void> {
  const now = new Date();
  const workflows = await prisma.workflow.findMany({
    where: { active: true, deletedAt: null, triggerKind: 'schedule' },
    // Deterministic order so a >SCAN_BATCH_SIZE backlog is paged consistently.
    orderBy: [{ lastRunAt: { sort: 'asc', nulls: 'first' } }, { id: 'asc' }],
    take: SCAN_BATCH_SIZE,
    select: {
      id: true,
      orgId: true,
      triggerConfig: true,
      lastRunAt: true,
      actions: {
        where: { deletedAt: null },
        orderBy: { sortOrder: 'asc' },
        select: { kind: true, config: true },
      },
    },
  });

  const due = workflows.filter((wf) =>
    isDue((wf.triggerConfig ?? {}) as Record<string, unknown>, wf.lastRunAt, now),
  );
  if (due.length === 0) {
    log.debug('no schedule workflows due');
    return;
  }

  const effects = buildWorkflowEffects(webhookQueue);
  for (const wf of due) {
    try {
      // Claim the run BEFORE doing any work — if another scan already advanced
      // lastRunAt, we lose the CAS and skip rather than double-run the actions.
      const claimed = await claimScheduleRun(wf.id, wf.orgId, wf.lastRunAt, now);
      if (!claimed) {
        log.debug({ workflowId: wf.id }, 'schedule run already claimed by a concurrent scan');
        continue;
      }

      const run = await prisma.workflowRun.create({
        data: { orgId: wf.orgId, workflowId: wf.id, status: 'running', input: {} },
        select: { id: true },
      });

      try {
        const { outputs, error } = await runWorkflowActions(
          wf.actions.map((a) => ({
            kind: a.kind as WorkflowActionKind,
            config: (a.config ?? {}) as Record<string, unknown>,
          })),
          { orgId: wf.orgId, input: {} },
          effects,
        );

        await prisma.$transaction(async (tx) => {
          // Org-scoped run finalization + count assertion (lastRunAt was already
          // advanced by the atomic claim above, so only runCount is bumped here).
          const { count } = await tx.workflowRun.updateMany({
            where: { id: run.id, orgId: wf.orgId },
            data: {
              status: error ? 'failed' : 'succeeded',
              output: outputs as Prisma.InputJsonValue,
              error,
              finishedAt: new Date(),
            },
          });
          if (count !== 1) throw new Error(`workflow run ${run.id} not finalized (count=${count})`);
          await tx.workflow.updateMany({
            where: { id: wf.id, orgId: wf.orgId },
            data: { runCount: { increment: 1 } },
          });
        });

        log.info({ workflowId: wf.id, runId: run.id, status: error ? 'failed' : 'succeeded' },
          'scheduled workflow run completed');
      } catch (innerErr) {
        // Effects ran but finalization threw: don't leave the run 'running'.
        await markRunFailed(run.id, wf.orgId, innerErr, log);
        throw innerErr;
      }
    } catch (err) {
      // Per-workflow isolation — one failure must not stop the rest of the scan.
      log.error({ err, workflowId: wf.id }, 'scheduled workflow run threw');
    }
  }
}

export async function startWorkflowScheduleWorker(
  connection: IORedis,
  log: pino.Logger,
  workers: Worker[],
  queues: Queue[],
  webhookQueue: WebhookDeliveryQueue,
): Promise<void> {
  const queue = new Queue(QUEUE_NAME, {
    connection,
    defaultJobOptions: WORKFLOW_SCHEDULE.defaultJobOptions,
  });
  queues.push(queue);

  const worker = new Worker(
    QUEUE_NAME,
    (_job: Job) => runDueSchedules(webhookQueue, log.child({ worker: QUEUE_NAME })),
    { connection, concurrency: 1 },
  );

  worker.on('failed', (job, err) => {
    log.warn({ jobId: job?.id, err: err.message }, 'workflow schedule scan failed');
  });

  workers.push(worker);

  // Register the repeatable scan (every 15 min). Idempotent jobId so a restart
  // doesn't stack duplicate repeatables.
  await queue.add(
    'workflow-schedule-scan',
    {},
    {
      repeat: { every: SCAN_INTERVAL_MINUTES * 60_000 },
      jobId: 'workflow-schedule-scan',
    },
  );

  log.info({ queue: QUEUE_NAME, intervalMinutes: SCAN_INTERVAL_MINUTES },
    'workflow schedule worker started (repeatable scan registered)');
}
