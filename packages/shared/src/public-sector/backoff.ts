import { PsSourceError } from './errors.js';

/** Backoff defaults from spec 3.3: exponential from 10 s, 5 attempts. */
export const BACKOFF_DEFAULTS = {
  baseMs: 10_000,
  maxMs: 15 * 60_000,
  maxAttempts: 5,
} as const;

/** Options shared by the backoff helpers. */
export interface BackoffOptions {
  baseMs?: number;
  maxMs?: number;
  maxAttempts?: number;
  random?: () => number;
}

/** Longest `Retry-After` honoured; a larger value from a server is clamped. */
export const MAX_RETRY_AFTER_MS = 60 * 60_000;

/**
 * Delay before retry number `attempt` (1-based): the exponential step
 * (10 s, 20 s, 40 s, ...) plus up to half of it again as jitter, capped at
 * `maxMs`. Parallel workers spread out but never retry faster than the step.
 */
export function backoffDelayMs(attempt: number, opts: BackoffOptions = {}): number {
  const base = opts.baseMs ?? BACKOFF_DEFAULTS.baseMs;
  const max = opts.maxMs ?? BACKOFF_DEFAULTS.maxMs;
  const random = opts.random ?? Math.random;
  const exponent = Math.min(Math.max(attempt, 1) - 1, 30);
  const step = base * 2 ** exponent;
  return Math.round(Math.min(max, step + random() * (step / 2)));
}

/** Parse a `Retry-After` header (seconds or HTTP date) into milliseconds. */
export function parseRetryAfterMs(header: string | null | undefined, now: Date = new Date()): number | null {
  if (!header) return null;
  const trimmed = header.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) return null;
  return Math.max(0, at - now.getTime());
}

/** What the queue should do after a failed attempt. */
export interface RetryDecision {
  retry: boolean;
  delayMs: number;
  /** Bad credential or exhausted quota: pause the source and audit `ps.source.paused`. */
  pauseSource: boolean;
}

/** Decide whether attempt number `attempt` (1-based, just failed) should be retried. */
export function decideRetry(err: unknown, attempt: number, opts: BackoffOptions = {}): RetryDecision {
  const maxAttempts = opts.maxAttempts ?? BACKOFF_DEFAULTS.maxAttempts;
  if (err instanceof PsSourceError && err.doNotRetry) {
    const pauseSource = err.kind === 'auth' || err.kind === 'quota_exhausted';
    return { retry: false, delayMs: 0, pauseSource };
  }
  if (attempt >= maxAttempts) return { retry: false, delayMs: 0, pauseSource: false };
  if (err instanceof PsSourceError && err.retryAfterMs !== null) {
    return { retry: true, delayMs: Math.min(err.retryAfterMs, MAX_RETRY_AFTER_MS), pauseSource: false };
  }
  return { retry: true, delayMs: backoffDelayMs(attempt, opts), pauseSource: false };
}
