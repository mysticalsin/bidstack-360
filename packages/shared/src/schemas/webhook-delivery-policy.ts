import { z } from 'zod';

/**
 * Per-endpoint webhook retry policy and the rules for what an attempt stores.
 * Shared by the worker (delivery), the API (validation) and the web editor
 * (backoff curve preview), so the preview is the schedule the worker runs.
 */

export const WEBHOOK_BACKOFF_STRATEGIES = ['exponential', 'linear', 'fixed'] as const;
export type WebhookBackoffStrategy = (typeof WEBHOOK_BACKOFF_STRATEGIES)[number];

export const WEBHOOK_RETRY_LIMITS = {
  maxAttempts: { min: 1, max: 10 },
  backoffBaseSeconds: { min: 5, max: 3600 },
  timeoutMs: { min: 1000, max: 30_000 },
} as const;

export const WebhookRetryPolicySchema = z.object({
  maxAttempts: z
    .number()
    .int()
    .min(WEBHOOK_RETRY_LIMITS.maxAttempts.min)
    .max(WEBHOOK_RETRY_LIMITS.maxAttempts.max),
  backoffStrategy: z.enum(WEBHOOK_BACKOFF_STRATEGIES),
  backoffBaseSeconds: z
    .number()
    .int()
    .min(WEBHOOK_RETRY_LIMITS.backoffBaseSeconds.min)
    .max(WEBHOOK_RETRY_LIMITS.backoffBaseSeconds.max),
  timeoutMs: z
    .number()
    .int()
    .min(WEBHOOK_RETRY_LIMITS.timeoutMs.min)
    .max(WEBHOOK_RETRY_LIMITS.timeoutMs.max),
});
export type WebhookRetryPolicy = z.infer<typeof WebhookRetryPolicySchema>;

/** The schedule every endpoint ran before policies existed (queue-config WEBHOOK_DELIVERY). */
export const DEFAULT_WEBHOOK_RETRY_POLICY: WebhookRetryPolicy = {
  maxAttempts: 5,
  backoffStrategy: 'exponential',
  backoffBaseSeconds: 30,
  timeoutMs: 10_000,
};

/** Hard ceiling on BullMQ attempts for a delivery job; the endpoint policy stops earlier. */
export const WEBHOOK_MAX_ATTEMPTS_CEILING = WEBHOOK_RETRY_LIMITS.maxAttempts.max;

const MAX_DELAY_MS = 6 * 3600_000;

/** Delay before the next try after failed attempt `failedAttempt` (1-based). */
export function webhookRetryDelayMs(policy: WebhookRetryPolicy, failedAttempt: number): number {
  const base = policy.backoffBaseSeconds * 1000;
  const n = Math.max(1, failedAttempt);
  const delay =
    policy.backoffStrategy === 'exponential'
      ? base * 2 ** (n - 1)
      : policy.backoffStrategy === 'linear'
        ? base * n
        : base;
  return Math.min(delay, MAX_DELAY_MS);
}

export interface WebhookRetryStep {
  attempt: number;
  /** Wait before this attempt (0 for the first). */
  delayMs: number;
  /** Offset of this attempt from the first one. */
  atMs: number;
}

export function webhookRetrySchedule(policy: WebhookRetryPolicy): WebhookRetryStep[] {
  const steps: WebhookRetryStep[] = [];
  let at = 0;
  for (let attempt = 1; attempt <= policy.maxAttempts; attempt += 1) {
    const delayMs = attempt === 1 ? 0 : webhookRetryDelayMs(policy, attempt - 1);
    at += delayMs;
    steps.push({ attempt, delayMs, atMs: at });
  }
  return steps;
}

/** Client errors a retry cannot fix (PRIOR-ART section 1, item 4). */
export const NON_RETRYABLE_WEBHOOK_STATUSES: ReadonlySet<number> = new Set([
  400, 401, 403, 404, 410, 422,
]);

/** `null` is a network error or timeout, which is retried. */
export function isRetryableWebhookStatus(status: number | null): boolean {
  if (status === null) return true;
  if (status >= 200 && status < 300) return false;
  return !NON_RETRYABLE_WEBHOOK_STATUSES.has(status);
}

const RETRY_AFTER_CAP_MS = 3600_000;

export function parseRetryAfterMs(header: string | null | undefined, now = Date.now()): number | null {
  if (!header) return null;
  const value = header.trim();
  if (/^\d+$/.test(value)) return Math.min(Number(value) * 1000, RETRY_AFTER_CAP_MS);
  const at = Date.parse(value);
  if (Number.isNaN(at)) return null;
  return Math.min(Math.max(0, at - now), RETRY_AFTER_CAP_MS);
}

export const WEBHOOK_MESSAGE_STATUSES = ['pending', 'succeeded', 'failed'] as const;
export type WebhookMessageStatus = (typeof WEBHOOK_MESSAGE_STATUSES)[number];

/** Stored request and response bodies are capped at this many UTF-8 bytes. */
export const WEBHOOK_BODY_CAP_BYTES = 4096;

const MASK = '****';

/** `t=<s>,v1=<hex>[,v1=<hex>]` keeps the timestamp and masks every HMAC. */
export function maskWebhookSignature(header: string): string {
  return header.replace(/(v\d+)=[^,]*/g, `$1=${MASK}`);
}

const SENSITIVE_KEY =
  /("(?:[\w-]*(?:secret|token|password|passwd|authorization|api[_-]?key|apikey|private[_-]?key|signature)[\w-]*)"\s*:\s*)("(?:[^"\\]|\\.)*"|[^,}\]\s]+)/gi;

/** Masks secret-looking values so a stored body never leaks a credential. */
export function redactWebhookText(text: string): string {
  return text
    .replace(SENSITIVE_KEY, `$1"${MASK}"`)
    .replace(/whsec_[A-Za-z0-9+/=_-]+/g, `whsec_${MASK}`)
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, `$1 ${MASK}`);
}

export function capWebhookText(
  text: string,
  capBytes = WEBHOOK_BODY_CAP_BYTES,
): { text: string; truncated: boolean } {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length <= capBytes) return { text, truncated: false };
  // fatal: false drops a split multi-byte character at the cut instead of throwing.
  let cut = new TextDecoder('utf-8', { fatal: false }).decode(bytes.slice(0, capBytes));
  if (cut.endsWith('\uFFFD')) cut = cut.slice(0, -1);
  return { text: cut, truncated: true };
}
