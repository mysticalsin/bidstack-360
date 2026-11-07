/**
 * Webhook outbox relay.
 *
 * Queue: webhook.outbox-relay (local config). One repeatable job claims due
 * rows from webhook_outbox and fans each out to the existing webhook.delivery
 * queue, which owns HTTP delivery, signing and its own retry policy.
 *
 * At-least-once fan-out, deduped downstream: every delivery job gets the
 * deterministic jobId outbox_<rowId>_<subscriptionId>, so a relay that crashes
 * after enqueueing but before marking the row dispatched re-adds the same ids
 * and BullMQ drops the duplicates while it still retains the earlier job. The
 * delivery worker derives the event id from the job id and eventTimestamp is
 * the row's createdAt, so a re-relayed event signs identically and partners
 * can dedupe on the event id.
 *
 * Failure handling: a failed enqueue is recorded and the row retried after the
 * exponential backoff (packages/db webhook-outbox.ts); after
 * WEBHOOK_OUTBOX_MAX_ATTEMPTS the row is dead-lettered (status 'dead', kept for
 * inspection, never retried).
 *
 * Started only when WEBHOOK_OUTBOX_ENABLED=true, the same flag that makes the
 * API write to the outbox.
 */
import { Queue, Worker, type Job } from 'bullmq';
import type IORedis from 'ioredis';
import type pino from 'pino';

import {
  claimWebhookOutboxBatch,
  markWebhookOutboxDispatched,
  markWebhookOutboxFailed,
  prisma,
  type WebhookOutboxRow,
} from '@bidstack/db';
import { WEBHOOK_DELIVERY } from '@bidstack/shared';

const QUEUE_NAME = 'webhook.outbox-relay';
const RELAY_INTERVAL_MS = 5_000;
const BATCH_SIZE = 100;

export type OutboxDeliveryJob = {
  name: string;
  data: {
    subscriptionId: string;
    event: string;
    payload: Record<string, unknown>;
    eventTimestamp: string;
  };
  opts: { jobId: string } & typeof WEBHOOK_DELIVERY.defaultJobOptions;
};

export interface OutboxRelayDeps {
  claim(limit: number): Promise<WebhookOutboxRow[]>;
  subscriptionIds(orgId: string, event: string): Promise<string[]>;
  enqueue(jobs: OutboxDeliveryJob[]): Promise<void>;
  markDispatched(id: string): Promise<void>;
  markFailed(id: string, error: string): Promise<'retry' | 'dead'>;
  log: Pick<pino.Logger, 'info' | 'warn' | 'error'>;
}

export type OutboxRelayResult = {
  claimed: number;
  dispatched: number;
  retried: number;
  dead: number;
};

export function outboxDeliveryJobId(rowId: string, subscriptionId: string): string {
  return `outbox_${rowId}_${subscriptionId}`;
}

export async function relayWebhookOutboxOnce(
  deps: OutboxRelayDeps,
  limit = BATCH_SIZE,
): Promise<OutboxRelayResult> {
  const rows = await deps.claim(limit);
  const result: OutboxRelayResult = { claimed: rows.length, dispatched: 0, retried: 0, dead: 0 };

  for (const row of rows) {
    try {
      const subs = await deps.subscriptionIds(row.orgId, row.event);
      if (subs.length > 0) {
        await deps.enqueue(
          subs.map((subscriptionId) => ({
            name: `${row.event}:${subscriptionId}`,
            data: {
              subscriptionId,
              event: row.event,
              payload: row.payload,
              eventTimestamp: row.createdAt.toISOString(),
            },
            opts: {
              jobId: outboxDeliveryJobId(row.id, subscriptionId),
              ...WEBHOOK_DELIVERY.defaultJobOptions,
            },
          })),
        );
      }
      await deps.markDispatched(row.id);
      result.dispatched += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const outcome = await deps.markFailed(row.id, message);
      if (outcome === 'dead') {
        result.dead += 1;
        deps.log.error(
          { outboxId: row.id, orgId: row.orgId, event: row.event, attempts: row.attempts },
          'webhook outbox row dead-lettered',
        );
      } else {
        result.retried += 1;
        deps.log.warn(
          { outboxId: row.id, attempts: row.attempts, err: message },
          'webhook outbox relay failed; will retry with backoff',
        );
      }
    }
  }
  return result;
}

export function webhookOutboxRelayEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.WEBHOOK_OUTBOX_ENABLED === 'true';
}

export async function startWebhookOutboxRelay(
  connection: IORedis,
  log: pino.Logger,
  workers: Worker[],
  queues: Queue[],
  deliveryQueue: Queue,
): Promise<void> {
  if (!webhookOutboxRelayEnabled()) return;

  const relayLog = log.child({ worker: QUEUE_NAME });
  const deps: OutboxRelayDeps = {
    claim: (limit) => claimWebhookOutboxBatch(prisma, limit),
    subscriptionIds: async (orgId, event) => {
      const subs = await prisma.webhookSubscription.findMany({
        where: { orgId, active: true, deletedAt: null, events: { has: event } },
        select: { id: true },
        take: 1000,
      });
      return subs.map((s) => s.id);
    },
    enqueue: async (jobs) => {
      await deliveryQueue.addBulk(jobs);
    },
    markDispatched: (id) => markWebhookOutboxDispatched(prisma, id),
    markFailed: (id, error) => markWebhookOutboxFailed(prisma, id, error),
    log: relayLog,
  };

  const queue = new Queue(QUEUE_NAME, {
    connection,
    defaultJobOptions: { removeOnComplete: 100, removeOnFail: 100 },
  });
  queues.push(queue);

  const worker = new Worker(
    QUEUE_NAME,
    async (_job: Job) => {
      const result = await relayWebhookOutboxOnce(deps);
      if (result.claimed > 0) relayLog.info(result, 'webhook outbox relay tick');
      return result;
    },
    { connection, concurrency: 1 },
  );
  worker.on('failed', (job, err) => {
    relayLog.warn({ jobId: job?.id, err: err.message }, 'webhook outbox relay tick failed');
  });
  workers.push(worker);

  // Idempotent jobId so a restart does not stack duplicate repeatables.
  await queue.add(
    'webhook-outbox-relay',
    {},
    { repeat: { every: RELAY_INTERVAL_MS }, jobId: 'webhook-outbox-relay' },
  );
  relayLog.info({ intervalMs: RELAY_INTERVAL_MS }, 'webhook outbox relay started');
}
