/**
 * Outbound webhook delivery worker.
 *
 * Consumes jobs from the `webhook.delivery` BullMQ queue and delivers
 * HMAC-SHA256-signed HTTP POST requests to partner-registered subscription URLs.
 *
 * Fan-out: when domain events fire (lead.created, opportunity.stage_changed, etc.),
 * callers enqueue one job per matching active subscription.
 *
 * Signature format (matches /docs/api/webhooks.md):
 *   X-BidStack-Signature: t=<unix-seconds>,v1=<hmac-sha256-hex>
 *   where the HMAC covers the string `${t}.${rawJsonBody}`.
 *
 * Retry schedule (configured in queue-config.ts WEBHOOK_DELIVERY):
 *   attempt 1: immediate
 *   attempt 2: +30 s
 *   attempt 3: +2 min
 *   attempt 4: +15 min (accumulated from exponential)
 *   attempt 5: +1 h
 * Dead-letter after 5 failures. Increments failureCount on the subscription.
 * Subscriptions with failureCount >= 10 are auto-disabled.
 */

import { createHmac } from 'node:crypto';
import { Queue, Worker, type Job } from 'bullmq';
import type IORedis from 'ioredis';
import type pino from 'pino';
import { z } from 'zod';

import { prisma } from '@bidstack/db';
import { WEBHOOK_DELIVERY } from '@bidstack/shared';

const QUEUE_NAME = WEBHOOK_DELIVERY.name;

/** Maximum time we wait for the partner endpoint to respond. */
const DELIVERY_TIMEOUT_MS = 10_000;

/** Auto-disable a subscription after this many consecutive failures. */
const AUTO_DISABLE_AFTER = 10;

// ── Job payload schema ────────────────────────────────────────────────────────

const DeliveryJobSchema = z.object({
  /** WebhookSubscription.id */
  subscriptionId: z.string().uuid(),
  /** The domain event type (e.g. "lead.created"). */
  event: z.string(),
  /** Full JSON payload to deliver. */
  payload: z.record(z.unknown()),
});

type DeliveryJob = z.infer<typeof DeliveryJobSchema>;

// ── HMAC signature ────────────────────────────────────────────────────────────

function buildSignatureHeader(secret: string, body: string): string {
  const t = Math.floor(Date.now() / 1000);
  const sig = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
  return `t=${t},v1=${sig}`;
}

// ── Delivery ──────────────────────────────────────────────────────────────────

async function deliver(
  url: string,
  secret: string,
  body: string,
): Promise<{ statusCode: number | null; durationMs: number; success: boolean; error?: string }> {
  const signature = buildSignatureHeader(secret, body);
  const start = Date.now();

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-BidStack-Signature': signature,
          'User-Agent': 'BidStack-Webhooks/1.0',
        },
        body,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    const durationMs = Date.now() - start;
    const success = res.status >= 200 && res.status < 300;
    return { statusCode: res.status, durationMs, success };
  } catch (err) {
    const durationMs = Date.now() - start;
    const error = err instanceof Error ? err.message : String(err);
    return { statusCode: null, durationMs, success: false, error };
  }
}

// ── Worker ────────────────────────────────────────────────────────────────────

async function processDeliveryJob(job: Job<DeliveryJob>, log: pino.Logger): Promise<void> {
  const parsed = DeliveryJobSchema.safeParse(job.data);
  if (!parsed.success) {
    log.warn({ jobId: job.id, issues: parsed.error.issues }, 'invalid webhook delivery job payload');
    return; // don't retry malformed jobs
  }

  const { subscriptionId, event, payload } = parsed.data;

  const sub = await prisma.webhookSubscription.findFirst({
    where: { id: subscriptionId, deletedAt: null, active: true },
    select: { id: true, orgId: true, url: true, secret: true, failureCount: true },
  });

  if (!sub) {
    // Subscription was deleted or disabled between enqueue and processing — skip silently.
    log.debug({ subscriptionId }, 'webhook subscription not found or inactive — skipping delivery');
    return;
  }

  const body = JSON.stringify({
    id: crypto.randomUUID(),
    event,
    orgId: sub.orgId,
    timestamp: new Date().toISOString(),
    data: payload,
  });

  const attempt = (job.attemptsMade ?? 0) + 1;
  const result = await deliver(sub.url, sub.secret, body);

  log.info(
    {
      subscriptionId,
      event,
      url: sub.url,
      statusCode: result.statusCode,
      durationMs: result.durationMs,
      success: result.success,
      attempt,
    },
    result.success ? 'webhook delivery succeeded' : 'webhook delivery failed',
  );

  // Record the delivery attempt.
  await prisma.webhookDelivery.create({
    data: {
      subscriptionId,
      orgId: sub.orgId,
      event,
      statusCode: result.statusCode,
      success: result.success,
      durationMs: result.durationMs,
      attempt,
      errorMessage: result.error ?? null,
    },
  });

  if (result.success) {
    // Reset failure counter and update lastDeliveryAt on success.
    await prisma.webhookSubscription.update({
      where: { id: subscriptionId },
      data: { lastDeliveryAt: new Date(), failureCount: 0 },
    });
  } else {
    const newFailureCount = sub.failureCount + 1;
    const shouldDisable = newFailureCount >= AUTO_DISABLE_AFTER && attempt >= 5;

    await prisma.webhookSubscription.update({
      where: { id: subscriptionId },
      data: {
        lastFailureAt: new Date(),
        failureCount: { increment: 1 },
        ...(shouldDisable ? { active: false } : {}),
      },
    });

    if (shouldDisable) {
      log.warn(
        { subscriptionId, failureCount: newFailureCount },
        'webhook subscription auto-disabled after repeated failures',
      );
    }

    // Throw so BullMQ schedules a retry (up to WEBHOOK_DELIVERY.defaultJobOptions.attempts).
    const err = new Error(
      result.error ?? `HTTP ${result.statusCode} from ${sub.url}`,
    );
    throw err;
  }
}

// ── Fan-out helper ─────────────────────────────────────────────────────────────

/**
 * Enqueues one delivery job per active subscription that matches `event`.
 * Call this from domain event handlers (e.g. after creating a lead).
 *
 * @param queue - The webhook delivery BullMQ queue instance.
 * @param orgId - The organisation that generated the event.
 * @param event - The event type string (e.g. `"lead.created"`).
 * @param payload - The event payload to deliver (will be JSON-serialized).
 */
export async function fanOutWebhookEvent(
  queue: Queue<DeliveryJob>,
  orgId: string,
  event: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const subs = await prisma.webhookSubscription.findMany({
    where: {
      orgId,
      active: true,
      deletedAt: null,
      events: { has: event },
    },
    select: { id: true },
  });

  if (subs.length === 0) return;

  const jobs = subs.map((sub) => ({
    name: `${event}:${sub.id}`,
    data: { subscriptionId: sub.id, event, payload } satisfies DeliveryJob,
    opts: {
      jobId: `${event}:${sub.id}:${Date.now()}`,
      ...WEBHOOK_DELIVERY.defaultJobOptions,
    },
  }));

  await queue.addBulk(jobs);
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

/**
 * Starts the webhook delivery worker and registers it with the worker pool.
 *
 * @param connection - IORedis connection shared with other workers.
 * @param log - Pino logger instance.
 * @param workers - Worker pool array — the new Worker is pushed here.
 * @param queues - Queue pool array — the new Queue is pushed here.
 * @returns The webhook delivery Queue (for use with {@link fanOutWebhookEvent}).
 */
export async function startWebhookDeliveryWorker(
  connection: IORedis,
  log: pino.Logger,
  workers: Worker[],
  queues: Queue[],
): Promise<Queue<DeliveryJob>> {
  const queue = new Queue<DeliveryJob>(QUEUE_NAME, {
    connection,
    defaultJobOptions: WEBHOOK_DELIVERY.defaultJobOptions,
  });
  queues.push(queue);

  const worker = new Worker<DeliveryJob>(
    QUEUE_NAME,
    (job) => processDeliveryJob(job, log.child({ worker: QUEUE_NAME })),
    {
      connection,
      concurrency: 20, // 20 concurrent HTTP deliveries
    },
  );

  worker.on('failed', (job, err) => {
    log.warn(
      { jobId: job?.id, subscriptionId: job?.data?.subscriptionId, err: err.message },
      'webhook delivery job failed',
    );
  });

  workers.push(worker);

  log.info({ queue: QUEUE_NAME, concurrency: 20 }, 'webhook delivery worker started');
  return queue;
}
