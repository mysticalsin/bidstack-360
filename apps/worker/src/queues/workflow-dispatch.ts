/**
 * Workflow dispatch worker.
 *
 * Queue: workflow.dispatch (WORKFLOW_DISPATCH in @bidstack/shared)
 *
 * Consumes one job per domain event (record_created / stage_changed), loads the
 * org's active, non-deleted workflows whose triggerKind + triggerConfig match
 * the event, and runs each through the SHARED engine (runWorkflowActions),
 * writing one WorkflowRun row per workflow — exactly like the manual API route.
 *
 * WHY at-least-once is acceptable: assign_owner / update_field are idempotent
 * (set-to-value). create_task / create_notification can duplicate on a retry;
 * events are rare and the WorkflowRun audit trail makes any double visible.
 */

import { Queue, Worker, type Job } from 'bullmq';
import type IORedis from 'ioredis';
import type pino from 'pino';

import { prisma, type Prisma } from '@bidstack/db';
import {
  WORKFLOW_DISPATCH,
  WorkflowDispatchJob,
  runWorkflowActions,
  workflowMatchesEvent,
  type WorkflowActionKind,
  type WorkflowTriggerEvent,
} from '@bidstack/shared';

import { buildWorkflowEffects } from '../services/workflow-effects.js';
import type { WebhookDeliveryQueue } from './webhook-delivery.js';

const QUEUE_NAME = WORKFLOW_DISPATCH.name;

/**
 * Load active, non-deleted workflows for the org whose triggerKind matches the
 * event, then narrow with the shared condition matcher (record type + optional
 * stage). Org scope is enforced in the WHERE clause; the matcher re-checks it.
 */
async function findMatchingWorkflows(event: WorkflowTriggerEvent) {
  const candidates = await prisma.workflow.findMany({
    where: {
      orgId: event.orgId,
      active: true,
      deletedAt: null,
      triggerKind: event.triggerKind,
    },
    // Bounded per the unbounded-findMany guard. An org realistically has a
    // handful of active workflows per trigger, so 1000 is generous headroom.
    orderBy: { createdAt: 'asc' },
    take: 1000,
    select: {
      id: true,
      orgId: true,
      active: true,
      triggerKind: true,
      triggerConfig: true,
      actions: {
        where: { deletedAt: null },
        orderBy: { sortOrder: 'asc' },
        select: { kind: true, config: true },
      },
    },
  });

  return candidates.filter((wf) =>
    workflowMatchesEvent(
      {
        orgId: wf.orgId,
        active: wf.active,
        triggerKind: wf.triggerKind,
        triggerConfig: (wf.triggerConfig ?? {}) as Record<string, unknown>,
      },
      event,
    ),
  );
}

/** Run one matched workflow and persist its WorkflowRun row. */
async function runOneWorkflow(
  wf: {
    id: string;
    orgId: string;
    actions: Array<{ kind: string; config: Prisma.JsonValue }>;
  },
  event: WorkflowTriggerEvent,
  effects: ReturnType<typeof buildWorkflowEffects>,
  log: pino.Logger,
): Promise<void> {
  const run = await prisma.workflowRun.create({
    data: {
      orgId: wf.orgId,
      workflowId: wf.id,
      status: 'running',
      triggerRecordType: event.recordType,
      triggerRecordId: event.recordId,
      input: event.changes as Prisma.InputJsonValue,
    },
    select: { id: true },
  });

  try {
    const { outputs, error } = await runWorkflowActions(
      wf.actions.map((a) => ({
        kind: a.kind as WorkflowActionKind,
        config: (a.config ?? {}) as Record<string, unknown>,
      })),
      {
        orgId: wf.orgId,
        triggerRecordType: event.recordType,
        triggerRecordId: event.recordId,
        input: event.changes,
      },
      effects,
    );

    await prisma.$transaction(async (tx) => {
      // Org-scope the run update (updateMany + count assertion) like every other
      // tenant write — a bare update({ where: { id } }) skips the org filter.
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
        data: { runCount: { increment: 1 }, lastRunAt: new Date() },
      });
    });

    log.info({ workflowId: wf.id, runId: run.id, status: error ? 'failed' : 'succeeded' },
      'workflow run completed');
  } catch (err) {
    // Effects ran but the completion transaction threw (or the engine threw):
    // the run row is still 'running'. Best-effort flip it to 'failed' so it
    // never leaks as a perpetually-running run; org-scoped, swallow on failure.
    await markRunFailed(run.id, wf.orgId, err, log);
    throw err;
  }
}

/**
 * Best-effort transition a stuck 'running' run to 'failed'. Org-scoped and
 * never throws — it's the last-resort cleanup after the completion path failed,
 * so a second DB error here must not mask the original one.
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
    log.error({ err: cleanupErr, runId }, 'failed to mark stuck workflow run as failed');
  }
}

export async function processDispatchJob(
  job: Job<WorkflowDispatchJob>,
  webhookQueue: WebhookDeliveryQueue,
  log: pino.Logger,
): Promise<void> {
  const parsed = WorkflowDispatchJob.safeParse(job.data);
  if (!parsed.success) {
    log.warn({ jobId: job.id, issues: parsed.error.issues }, 'invalid workflow dispatch payload');
    return; // don't retry malformed jobs
  }

  const event: WorkflowTriggerEvent = {
    orgId: parsed.data.orgId,
    triggerKind: parsed.data.triggerKind,
    recordType: parsed.data.recordType,
    recordId: parsed.data.recordId,
    changes: parsed.data.changes,
  };

  const matched = await findMatchingWorkflows(event);
  if (matched.length === 0) {
    log.debug({ orgId: event.orgId, triggerKind: event.triggerKind }, 'no matching workflows');
    return;
  }

  const effects = buildWorkflowEffects(webhookQueue);
  for (const wf of matched) {
    // Isolate per-workflow: one workflow's hard failure must not abort the rest.
    try {
      await runOneWorkflow(wf, event, effects, log);
    } catch (err) {
      log.error({ err, workflowId: wf.id }, 'workflow run threw outside the engine loop');
    }
  }
}

export async function startWorkflowDispatchWorker(
  connection: IORedis,
  log: pino.Logger,
  workers: Worker[],
  queues: Queue[],
  webhookQueue: WebhookDeliveryQueue,
): Promise<void> {
  const queue = new Queue<WorkflowDispatchJob>(QUEUE_NAME, {
    connection,
    defaultJobOptions: WORKFLOW_DISPATCH.defaultJobOptions,
  });
  queues.push(queue);

  const worker = new Worker<WorkflowDispatchJob>(
    QUEUE_NAME,
    (job) => processDispatchJob(job, webhookQueue, log.child({ worker: QUEUE_NAME })),
    { connection, concurrency: 5 },
  );

  worker.on('failed', (job, err) => {
    log.warn({ jobId: job?.id, err: err.message }, 'workflow dispatch job failed');
  });

  workers.push(worker);
  log.info({ queue: QUEUE_NAME, concurrency: 5 }, 'workflow dispatch worker started');
}
