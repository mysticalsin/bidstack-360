/**
 * Producer-side handle for the `workflow.dispatch` queue.
 *
 * Route handlers call {@link dispatchWorkflowEvent} right next to the existing
 * webhook fan-out after a domain event (record_created / stage_changed). The
 * worker (apps/worker/src/queues/workflow-dispatch.ts) loads matching active
 * workflows and runs each through the shared engine.
 *
 * WHY fail-open: like webhook fan-out, a Redis hiccup must NOT fail the
 * originating create/transition request. We log and continue.
 */

import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import pino from 'pino';

import { WORKFLOW_DISPATCH, type WorkflowDispatchJob } from '@bidstack/shared';

const log = pino({ name: 'queue:workflow-dispatch', level: process.env.LOG_LEVEL ?? 'info' });

let queueSingleton: Queue<WorkflowDispatchJob> | null = null;
let connectionSingleton: IORedis | null = null;

function getQueue(): Queue<WorkflowDispatchJob> {
  if (queueSingleton) return queueSingleton;

  const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6380';
  connectionSingleton = new IORedis(redisUrl, {
    maxRetriesPerRequest: null,
    enableOfflineQueue: true,
    lazyConnect: false,
  });
  connectionSingleton.on('error', (err) => {
    log.error({ err }, 'Redis error in workflow-dispatch queue producer');
  });

  queueSingleton = new Queue<WorkflowDispatchJob>(WORKFLOW_DISPATCH.name, {
    connection: connectionSingleton,
    defaultJobOptions: WORKFLOW_DISPATCH.defaultJobOptions,
  });
  return queueSingleton;
}

/**
 * Enqueue a single workflow-dispatch job for a domain event. The worker decides
 * which workflows match — the producer stays cheap (no DB read here).
 *
 * @param orgId       - Org that generated the event.
 * @param triggerKind - 'record_created' | 'stage_changed'.
 * @param recordType  - e.g. 'opportunity' | 'lead' | 'task'.
 * @param recordId    - The triggering record id.
 * @param changes     - Event-specific fields (e.g. `{ stage }` for stage_changed).
 */
export async function dispatchWorkflowEvent(
  orgId: string,
  triggerKind: WorkflowDispatchJob['triggerKind'],
  recordType: string,
  recordId: string,
  changes: Record<string, unknown> = {},
): Promise<void> {
  try {
    const queue = getQueue();
    // BullMQ forbids ':' in job IDs — Redis uses it as a key namespace separator.
    const safeKind = triggerKind.replace(/[^a-zA-Z0-9_.-]/g, '_');
    await queue.add(
      `${triggerKind}:${recordType}:${recordId}`,
      { orgId, triggerKind, recordType, recordId, changes } satisfies WorkflowDispatchJob,
      { jobId: `wf_${safeKind}_${recordId}_${Date.now()}`, ...WORKFLOW_DISPATCH.defaultJobOptions },
    );
    log.info({ orgId, triggerKind, recordType, recordId }, 'workflow dispatch job enqueued');
  } catch (err) {
    // Fail open — never propagate into the calling route handler.
    log.error({ err, orgId, triggerKind, recordType, recordId }, 'failed to enqueue workflow dispatch');
  }
}
