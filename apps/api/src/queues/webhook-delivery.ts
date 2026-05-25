/**
 * Producer-side handle for the `webhook.delivery` queue.
 *
 * Route handlers (and service layer) call {@link fanOutWebhookEvent} after
 * domain events (lead.created, opportunity.stage_changed, etc.).
 * The actual HTTP delivery is performed by apps/worker.
 *
 * WHY fail-open: if Redis is momentarily unavailable we still return 200/201
 * from the API — webhook delivery is best-effort and logged separately.
 */

import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import pino from 'pino';

import { prisma } from '@bidstack/db';
import { WEBHOOK_DELIVERY } from '@bidstack/shared';

const log = pino({ name: 'queue:webhook-delivery', level: process.env.LOG_LEVEL ?? 'info' });

interface DeliveryJob {
  subscriptionId: string;
  event: string;
  payload: Record<string, unknown>;
}

let queueSingleton: Queue<DeliveryJob> | null = null;
let connectionSingleton: IORedis | null = null;

function getQueue(): Queue<DeliveryJob> {
  if (queueSingleton) return queueSingleton;

  const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6380';
  connectionSingleton = new IORedis(redisUrl, {
    maxRetriesPerRequest: null,
    enableOfflineQueue: true,
    lazyConnect: false,
  });
  connectionSingleton.on('error', (err) => {
    log.error({ err }, 'Redis error in webhook-delivery queue producer');
  });

  queueSingleton = new Queue<DeliveryJob>(WEBHOOK_DELIVERY.name, {
    connection: connectionSingleton,
    defaultJobOptions: WEBHOOK_DELIVERY.defaultJobOptions,
  });
  return queueSingleton;
}

/**
 * Queries active subscriptions for the org matching `event` and enqueues one
 * delivery job per subscription. Fire-and-forget — callers don't await the
 * individual deliveries; failures are retried by the worker.
 *
 * @param orgId  - The organisation that generated the event.
 * @param event  - Domain event type, e.g. `"lead.created"`.
 * @param payload - The full event payload (will be JSON-serialized in the worker).
 */
export async function fanOutWebhookEvent(
  orgId: string,
  event: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const subs = await prisma.webhookSubscription.findMany({
    where: { orgId, active: true, deletedAt: null, events: { has: event } },
    select: { id: true },
    take: 1000,
  });

  if (subs.length === 0) return;

  try {
    const queue = getQueue();
    const jobs = subs.map((sub) => ({
      name: `${event}:${sub.id}`,
      data: { subscriptionId: sub.id, event, payload } satisfies DeliveryJob,
      opts: {
        jobId: `${event}:${sub.id}:${Date.now()}`,
        ...WEBHOOK_DELIVERY.defaultJobOptions,
      },
    }));
    await queue.addBulk(jobs);
    log.info({ orgId, event, count: subs.length }, 'webhook delivery jobs enqueued');
  } catch (err) {
    // Fail open — log and continue; don't throw into the calling route handler.
    log.error({ err, orgId, event }, 'failed to enqueue webhook delivery jobs');
  }
}
