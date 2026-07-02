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

import { createHash, createHmac, randomUUID } from 'node:crypto';
import { Queue, UnrecoverableError, Worker, type Job } from 'bullmq';
import type IORedis from 'ioredis';
import type pino from 'pino';
import { z } from 'zod';

import { prisma } from '@bidstack/db';
import { WEBHOOK_DELIVERY, assertSafeWebhookUrl } from '@bidstack/shared';
import {
  decryptWebhookSigningSecret,
  isLegacyWebhookSigningSecret,
} from '@bidstack/shared/server-crypto';

import { createResearchFetch } from '../lib/safe-research-fetch.js';
import { serumConnectorDenialMessage } from '../lib/serum-connector-policy.js';

const QUEUE_NAME = WEBHOOK_DELIVERY.name;

/**
 * DNS-rebind-safe fetch: resolves the host and rejects internal IPs before each
 * hop (initial URL + every redirect). Closes the SSRF gap the https-only string
 * check (`assertSafeWebhookUrl`) cannot catch on its own.
 */
const safeFetch = createResearchFetch();

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
  /**
   * Stable event identity, stamped ONCE at enqueue (see fanOutWebhookEvent).
   * WHY optional: jobs enqueued before this field existed (or by the API-side
   * producer that hasn't been updated) fall back to job-derived stable values,
   * so dedup still holds across the 5 retries. Never regenerate per attempt.
   */
  eventId: z.string().uuid().optional(),
  /** ISO-8601 timestamp of the originating event, stamped once at enqueue. */
  eventTimestamp: z.string().datetime().optional(),
});

type DeliveryJob = z.infer<typeof DeliveryJobSchema>;

/** The webhook-delivery producer queue, shared by fan-out callers (e.g. the
 * workflow engine's `call_webhook` effect) so they don't open their own. */
export type WebhookDeliveryQueue = Queue<DeliveryJob>;

// ── HMAC signature ────────────────────────────────────────────────────────────

/**
 * Builds the `t=<unix-seconds>,v1=<hmac>` header. The HMAC covers the documented
 * `${t}.${body}` string. `tSeconds` is passed in (not read from the clock here)
 * so all retries of a job sign with the SAME timestamp — partner-side replay /
 * dedup windows key on `t`, so a per-attempt `t` would defeat them.
 */
function buildSignatureHeader(secret: string, body: string, tSeconds: number): string {
  const sig = createHmac('sha256', secret).update(`${tSeconds}.${body}`).digest('hex');
  return `t=${tSeconds},v1=${sig}`;
}

/**
 * Deterministically derives a stable event UUID from the BullMQ job id. WHY:
 * `job.id` is constant across all retries of a job, so the same delivery always
 * carries the same event id — the property partner dedup relies on. Formatted as
 * an RFC-4122 v5-style UUID (deterministic, namespaced by the SHA-256 of job.id)
 * so it satisfies the `id: uuid` contract documented in /docs/api/webhooks.md.
 */
function deriveStableEventId(job: Job<DeliveryJob>): string {
  const seed = job.id ?? `${job.name}:${job.timestamp}`;
  const h = createHash('sha256').update(`webhook.delivery:${seed}`).digest('hex');
  // Splice RFC-4122 version (5) and variant (8/9/a/b) bits into the digest.
  return [
    h.slice(0, 8),
    h.slice(8, 12),
    `5${h.slice(13, 16)}`,
    `${((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16)}${h.slice(17, 20)}`,
    h.slice(20, 32),
  ].join('-');
}

// ── Delivery ──────────────────────────────────────────────────────────────────

async function deliver(
  url: string,
  secret: string,
  body: string,
  tSeconds: number,
): Promise<{ statusCode: number | null; durationMs: number; success: boolean; error?: string }> {
  try {
    assertSafeWebhookUrl(url);
  } catch (err) {
    return {
      statusCode: null,
      durationMs: 0,
      success: false,
      error: err instanceof Error ? `Unsafe webhook URL: ${err.message}` : 'Unsafe webhook URL',
    };
  }

  const signature = buildSignatureHeader(secret, body, tSeconds);
  const start = Date.now();

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);

    let res: Response;
    try {
      res = await safeFetch(url, {
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

export async function processDeliveryJob(job: Job<DeliveryJob>, log: pino.Logger): Promise<void> {
  const parsed = DeliveryJobSchema.safeParse(job.data);
  if (!parsed.success) {
    log.warn(
      { jobId: job.id, issues: parsed.error.issues },
      'invalid webhook delivery job payload',
    );
    return; // don't retry malformed jobs
  }

  const { subscriptionId, event, payload, eventId, eventTimestamp } = parsed.data;

  // Stable event identity — computed ONCE per job, reused across all 5 retries so
  // partner-side dedup works. Prefer the values stamped at enqueue; fall back to
  // job-derived values (job.id and job.timestamp are both stable across retries).
  const stableEventId = eventId ?? deriveStableEventId(job);
  const stableTimestamp = eventTimestamp ?? new Date(job.timestamp).toISOString();
  // The signature `t` (unix seconds) is derived from the SAME stable timestamp,
  // not the wall clock, so every retry signs identically.
  const stableTSeconds = Math.floor(new Date(stableTimestamp).getTime() / 1000);

  const sub = await prisma.webhookSubscription.findFirst({
    where: { id: subscriptionId, deletedAt: null, active: true },
    select: {
      id: true,
      orgId: true,
      url: true,
      secret: true,
      failureCount: true,
    },
  });

  if (!sub) {
    // Subscription was deleted or disabled between enqueue and processing — skip silently.
    log.debug({ subscriptionId }, 'webhook subscription not found or inactive — skipping delivery');
    return;
  }

  const body = JSON.stringify({
    id: stableEventId,
    event,
    orgId: sub.orgId,
    timestamp: stableTimestamp,
    data: payload,
  });

  const attempt = (job.attemptsMade ?? 0) + 1;
  const denial = await serumConnectorDenialMessage({
    orgId: sub.orgId,
    connectorId: 'webhook_delivery',
    operation: `webhook.deliver.${event}`,
    writeRequested: true,
  });
  if (denial) {
    log.warn({ subscriptionId, event, attempt }, denial);
    await prisma.webhookDelivery.create({
      data: {
        subscriptionId,
        orgId: sub.orgId,
        event,
        statusCode: null,
        success: false,
        durationMs: 0,
        attempt,
        errorMessage: denial,
      },
    });
    return;
  }

  let result: Awaited<ReturnType<typeof deliver>>;
  // Set only when decryptWebhookSigningSecret throws. Both of its failure causes
  // (legacy plaintext disabled in prod, or a wrong INTEGRATION_TOKEN_KEY /
  // corrupted blob) are deterministic and can never succeed on retry, so BullMQ
  // must not burn the full 5-attempt/~1.5h retry schedule on them.
  let unrecoverableDecryptError: string | null = null;
  try {
    result = await deliver(sub.url, decryptWebhookSigningSecret(sub.secret), body, stableTSeconds);
  } catch (err) {
    unrecoverableDecryptError = isLegacyWebhookSigningSecret(sub.secret)
      ? 'Stored webhook signing secret is legacy plaintext and the fallback is disabled; run the webhook secret encryption backfill (scripts/encrypt-webhook-secrets.ts).'
      : 'Stored webhook signing secret is not decryptable — key mismatch or corrupted secret; the encryption backfill will not fix this.';
    log.warn({ subscriptionId, event, err }, unrecoverableDecryptError);
    result = {
      statusCode: null,
      durationMs: 0,
      success: false,
      error: unrecoverableDecryptError,
    };
  }

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

    // A decrypt failure is deterministic — retrying can never succeed — so tell
    // BullMQ to fail the job outright instead of scheduling a retry.
    if (unrecoverableDecryptError) {
      throw new UnrecoverableError(unrecoverableDecryptError);
    }

    // Throw so BullMQ schedules a retry (up to WEBHOOK_DELIVERY.defaultJobOptions.attempts).
    const err = new Error(result.error ?? `HTTP ${result.statusCode} from ${sub.url}`);
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

  // Stamp the stable event identity ONCE here, at enqueue. Every retry of the
  // resulting job reuses these exact values, so partner-side dedup holds across
  // the full 5-attempt retry schedule (each subscription gets its own event id).
  const eventTimestamp = new Date().toISOString();

  const jobs = subs.map((sub) => ({
    name: `${event}:${sub.id}`,
    data: {
      subscriptionId: sub.id,
      event,
      payload,
      eventId: randomUUID(),
      eventTimestamp,
    } satisfies DeliveryJob,
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
