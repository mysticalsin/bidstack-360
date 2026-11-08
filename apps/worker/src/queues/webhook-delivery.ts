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
 *   X-Polo-Signature: t=<unix-seconds>,v1=<hmac-sha256-hex>
 *   where the HMAC covers the string `${t}.${rawJsonBody}`.
 *   The legacy X-BidStack-Signature header carries the same value during the
 *   rebrand deprecation window so existing receivers keep verifying.
 *
 * Retry schedule: per endpoint (WebhookSubscription maxAttempts, backoffStrategy,
 * backoffBaseSeconds, timeoutMs). The default is 5 attempts, exponential from
 * 30 s: +30 s, +1 min, +2 min, +4 min between tries. The queue allows up to
 * WEBHOOK_MAX_ATTEMPTS_CEILING tries and the job stops itself at the endpoint
 * limit. A non-retryable 4xx (410 Gone, 404, ...) fails at once; a 429 or 503
 * Retry-After header sets the next delay. Increments failureCount on the
 * subscription; subscriptions with failureCount >= 10 are auto-disabled.
 *
 * Every attempt upserts one WebhookMessage (keyed by the stable event id) and
 * records a WebhookDelivery row with masked request headers and a redacted,
 * size-capped response body for the message log.
 */

import { createHash, createHmac, randomUUID } from 'node:crypto';
import { Queue, UnrecoverableError, Worker, type Job } from 'bullmq';
import type IORedis from 'ioredis';
import type pino from 'pino';
import { z } from 'zod';

import { prisma } from '@bidstack/db';
import {
  DEFAULT_WEBHOOK_RETRY_POLICY,
  WEBHOOK_BODY_CAP_BYTES,
  WEBHOOK_DELIVERY,
  WEBHOOK_MAX_ATTEMPTS_CEILING,
  assertSafeWebhookUrl,
  capWebhookText,
  isRetryableWebhookStatus,
  maskWebhookSignature,
  parseRetryAfterMs,
  redactWebhookText,
  webhookRetryDelayMs,
  type WebhookRetryPolicy,
} from '@bidstack/shared';
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
  /** Set on a replay: the WebhookMessage this delivery re-sends. */
  replayOfId: z.string().uuid().optional(),
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
function buildSignatureHeader(secrets: string[], body: string, tSeconds: number): string {
  const sigs = secrets.map(
    (secret) => `v1=${createHmac('sha256', secret).update(`${tSeconds}.${body}`).digest('hex')}`,
  );
  return [`t=${tSeconds}`, ...sigs].join(',');
}

/** An Error that tells {@link webhookBackoffStrategy} how long to wait. */
class WebhookRetryError extends Error {
  constructor(
    message: string,
    readonly retryDelayMs: number,
  ) {
    super(message);
    this.name = 'WebhookRetryError';
  }
}

/** BullMQ backoff type registered on the delivery worker. */
export const WEBHOOK_BACKOFF_TYPE = 'webhook-endpoint';

/**
 * Custom BullMQ backoff: the delay the failed attempt computed from its
 * endpoint policy (or Retry-After), else the default curve.
 */
export function webhookBackoffStrategy(attemptsMade: number, _type?: string, err?: Error): number {
  const fromAttempt = (err as { retryDelayMs?: unknown } | undefined)?.retryDelayMs;
  if (typeof fromAttempt === 'number' && Number.isFinite(fromAttempt) && fromAttempt >= 0) {
    return fromAttempt;
  }
  return webhookRetryDelayMs(DEFAULT_WEBHOOK_RETRY_POLICY, attemptsMade);
}

/** Reads at most `capBytes` of a response body without buffering the rest. */
async function readCappedBody(res: Response): Promise<{ text: string; truncated: boolean } | null> {
  const stream = (res as Partial<Response>).body;
  if (!stream || typeof stream.getReader !== 'function') return null;
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let truncated = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.byteLength;
      if (size > WEBHOOK_BODY_CAP_BYTES) {
        truncated = true;
        break;
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const joined = Buffer.concat(chunks).toString('utf8');
  const capped = capWebhookText(redactWebhookText(joined));
  return { text: capped.text, truncated: truncated || capped.truncated };
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

type DeliveryResult = {
  statusCode: number | null;
  durationMs: number;
  success: boolean;
  error?: string;
  requestHeaders?: Record<string, string>;
  responseBody?: string | null;
  responseTruncated?: boolean;
  retryAfterMs?: number | null;
  /** The URL failed the safety check, so no retry can succeed. */
  unsafeUrl?: boolean;
};

function maskedHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = /signature/i.test(k) ? maskWebhookSignature(v) : v;
  }
  return out;
}

async function deliver(
  url: string,
  secrets: string[],
  body: string,
  tSeconds: number,
  timeoutMs: number,
): Promise<DeliveryResult> {
  try {
    assertSafeWebhookUrl(url);
  } catch (err) {
    return {
      statusCode: null,
      durationMs: 0,
      success: false,
      error: err instanceof Error ? `Unsafe webhook URL: ${err.message}` : 'Unsafe webhook URL',
      unsafeUrl: true,
    };
  }

  const signature = buildSignatureHeader(secrets, body, tSeconds);
  const headers = {
    'Content-Type': 'application/json',
    'X-Polo-Signature': signature,
    // Legacy header kept during the rebrand deprecation window.
    'X-BidStack-Signature': signature,
    'User-Agent': 'PoloPreSales-Webhooks/1.0',
  };
  const requestHeaders = maskedHeaders(headers);
  const start = Date.now();

  try {
    const controller = new AbortController();
    // The timeout covers the body read too: an endpoint that sends headers and
    // then stalls the body must not hold a worker slot past timeoutMs.
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    let res: Response;
    let read: Awaited<ReturnType<typeof readCappedBody>>;
    let durationMs: number;
    try {
      res = await safeFetch(url, {
        method: 'POST',
        headers,
        body,
        signal: controller.signal,
      });
      durationMs = Date.now() - start;
      read = await readCappedBody(res).catch(() => null);
    } finally {
      clearTimeout(timeoutId);
    }

    const success = res.status >= 200 && res.status < 300;
    const retryAfter =
      res.status === 429 || res.status === 503
        ? parseRetryAfterMs((res as Partial<Response>).headers?.get?.('retry-after'))
        : null;
    return {
      statusCode: res.status,
      durationMs,
      success,
      requestHeaders,
      responseBody: read?.text ?? null,
      responseTruncated: read?.truncated ?? false,
      retryAfterMs: retryAfter,
    };
  } catch (err) {
    const durationMs = Date.now() - start;
    const error = err instanceof Error ? err.message : String(err);
    return { statusCode: null, durationMs, success: false, error, requestHeaders };
  }
}

function policyOf(sub: Partial<WebhookRetryPolicy>): WebhookRetryPolicy {
  return {
    maxAttempts: sub.maxAttempts ?? DEFAULT_WEBHOOK_RETRY_POLICY.maxAttempts,
    backoffStrategy: sub.backoffStrategy ?? DEFAULT_WEBHOOK_RETRY_POLICY.backoffStrategy,
    backoffBaseSeconds: sub.backoffBaseSeconds ?? DEFAULT_WEBHOOK_RETRY_POLICY.backoffBaseSeconds,
    timeoutMs: sub.timeoutMs ?? DEFAULT_WEBHOOK_RETRY_POLICY.timeoutMs,
  };
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

  const { subscriptionId, event, payload, eventId, eventTimestamp, replayOfId } = parsed.data;

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
      maxAttempts: true,
      backoffStrategy: true,
      backoffBaseSeconds: true,
      timeoutMs: true,
      previousSecret: true,
      previousSecretExpiresAt: true,
    },
  });

  if (!sub) {
    // A retry can arrive after the endpoint was paused, deleted, or auto-disabled.
    // The previous attempt left the message pending; leave it failed so the log
    // does not show "Retrying" after no retry remains.
    await prisma.webhookMessage.updateMany({
      where: { id: stableEventId, status: 'pending' },
      data: { status: 'failed' },
    });
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
  const policy = policyOf(sub);
  // A policy edit applies to the next attempt. Do not send when this try is
  // already past the budget the endpoint has now.
  const attemptLimit = Math.min(policy.maxAttempts, job.opts?.attempts ?? WEBHOOK_MAX_ATTEMPTS_CEILING);

  /** One message per stable event id; every attempt refreshes its status. */
  const recordMessage = async (status: 'pending' | 'succeeded' | 'failed', r: DeliveryResult) => {
    await prisma.webhookMessage.upsert({
      where: { id: stableEventId },
      create: {
        id: stableEventId,
        orgId: sub.orgId,
        subscriptionId,
        event,
        payload: payload as object,
        eventTimestamp: new Date(stableTimestamp),
        status,
        attempts: attempt,
        lastStatusCode: r.statusCode,
        lastDurationMs: r.durationMs,
        replayOfId: replayOfId ?? null,
      },
      update: {
        status,
        attempts: attempt,
        lastStatusCode: r.statusCode,
        lastDurationMs: r.durationMs,
      },
    });
  };

  if (attempt > attemptLimit) {
    await recordMessage('failed', {
      statusCode: null,
      durationMs: 0,
      success: false,
      error: 'Attempt budget exhausted',
    });
    throw new UnrecoverableError('webhook attempt budget exhausted');
  }

  const denial = await serumConnectorDenialMessage({
    orgId: sub.orgId,
    connectorId: 'webhook_delivery',
    operation: `webhook.deliver.${event}`,
    writeRequested: true,
  });
  if (denial) {
    log.warn({ subscriptionId, event, attempt }, denial);
    await recordMessage('failed', { statusCode: null, durationMs: 0, success: false, error: denial });
    await prisma.webhookDelivery.create({
      data: {
        subscriptionId,
        orgId: sub.orgId,
        event,
        statusCode: null,
        success: false,
        durationMs: 0,
        messageId: stableEventId,
        attempt,
        errorMessage: denial,
      },
    });
    return;
  }

  // The previous secret also signs until its overlap window closes, so a
  // receiver mid-rotation verifies with either.
  const secretsFor = (current: string): string[] => {
    const keep =
      sub.previousSecret && sub.previousSecretExpiresAt && sub.previousSecretExpiresAt.getTime() > Date.now();
    if (!keep) return [current];
    try {
      return [current, decryptWebhookSigningSecret(sub.previousSecret!)];
    } catch {
      return [current];
    }
  };

  let result: DeliveryResult;
  // Set only when decryptWebhookSigningSecret throws. Both of its failure causes
  // (legacy plaintext disabled in prod, or a wrong INTEGRATION_TOKEN_KEY /
  // corrupted blob) are deterministic and can never succeed on retry, so BullMQ
  // must not burn the full 5-attempt/~1.5h retry schedule on them.
  let unrecoverableDecryptError: string | null = null;
  try {
    result = await deliver(
      sub.url,
      secretsFor(decryptWebhookSigningSecret(sub.secret)),
      body,
      stableTSeconds,
      policy.timeoutMs,
    );
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

  const retryable =
    !unrecoverableDecryptError &&
    !result.unsafeUrl &&
    attempt < attemptLimit &&
    isRetryableWebhookStatus(result.statusCode);
  await recordMessage(result.success ? 'succeeded' : retryable ? 'pending' : 'failed', result);

  // Record the delivery attempt.
  await prisma.webhookDelivery.create({
    data: {
      subscriptionId,
      orgId: sub.orgId,
      messageId: stableEventId,
      event,
      statusCode: result.statusCode,
      success: result.success,
      durationMs: result.durationMs,
      attempt,
      errorMessage: result.error ?? null,
      ...(result.requestHeaders ? { requestHeaders: result.requestHeaders } : {}),
      responseBody: result.responseBody ?? null,
      responseTruncated: result.responseTruncated ?? false,
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
    // A final failure (last attempt or a status no retry can fix) counts
    // towards auto-disable, so a 410 Gone endpoint is disabled too.
    const shouldDisable = newFailureCount >= AUTO_DISABLE_AFTER && !retryable;

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

    const message = result.error ?? `HTTP ${result.statusCode} from ${sub.url}`;
    // A 4xx a retry cannot fix, or the endpoint's last allowed attempt.
    if (!retryable) throw new UnrecoverableError(message);

    // Throw so BullMQ schedules a retry after the endpoint's own delay.
    throw new WebhookRetryError(message, result.retryAfterMs ?? webhookRetryDelayMs(policy, attempt));
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
      settings: { backoffStrategy: webhookBackoffStrategy },
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
