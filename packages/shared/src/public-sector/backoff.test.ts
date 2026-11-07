import { describe, expect, it } from 'vitest';

import { BACKOFF_DEFAULTS, backoffDelayMs, decideRetry, parseRetryAfterMs } from './backoff.js';
import { PsSourceError } from './errors.js';

describe('exponential backoff with jitter', () => {
  it('starts at 10 s and allows 5 attempts (spec 3.3)', () => {
    expect(BACKOFF_DEFAULTS.baseMs).toBe(10_000);
    expect(BACKOFF_DEFAULTS.maxAttempts).toBe(5);
  });

  it('doubles the ceiling per attempt and jitters inside [ceiling/2, ceiling]', () => {
    const low = () => 0;
    const high = () => 0.999_999;
    expect(backoffDelayMs(1, { random: low })).toBe(5_000);
    expect(backoffDelayMs(1, { random: high })).toBeLessThanOrEqual(10_000);
    expect(backoffDelayMs(2, { random: low })).toBe(10_000);
    expect(backoffDelayMs(3, { random: low })).toBe(20_000);
    expect(backoffDelayMs(4, { random: high })).toBeLessThanOrEqual(80_000);
  });

  it('spreads retries so parallel workers do not retry in lockstep', () => {
    const delays = new Set([0.1, 0.4, 0.7].map((r) => backoffDelayMs(3, { random: () => r })));
    expect(delays.size).toBe(3);
  });

  it('caps the delay', () => {
    expect(backoffDelayMs(30, { random: () => 0.999, maxMs: 60_000 })).toBeLessThanOrEqual(60_000);
  });
});

describe('retry decisions', () => {
  it('never retries a bad ticket or an exhausted quota', () => {
    const auth = new PsSourceError('auth', 'Ticket rejected', { doNotRetry: true });
    const quota = new PsSourceError('quota_exhausted', 'Daily quota reached', { doNotRetry: true });
    expect(decideRetry(auth, 1)).toEqual({ retry: false, delayMs: 0, pauseSource: true });
    expect(decideRetry(quota, 1)).toEqual({ retry: false, delayMs: 0, pauseSource: true });
  });

  it('honours Retry-After on 429 instead of the computed delay', () => {
    const limited = new PsSourceError('rate_limited', 'HTTP 429', { retryAfterMs: 42_000 });
    expect(decideRetry(limited, 1, { random: () => 0 })).toEqual({
      retry: true,
      delayMs: 42_000,
      pauseSource: false,
    });
  });

  it('stops after the last attempt', () => {
    const transient = new PsSourceError('http', 'HTTP 503');
    expect(decideRetry(transient, 4, { random: () => 0 }).retry).toBe(true);
    expect(decideRetry(transient, 5, { random: () => 0 }).retry).toBe(false);
  });

  it('parses both Retry-After forms', () => {
    const now = new Date('2026-11-06T12:00:00Z');
    expect(parseRetryAfterMs('120', now)).toBe(120_000);
    expect(parseRetryAfterMs('Fri, 06 Nov 2026 12:01:00 GMT', now)).toBe(60_000);
    expect(parseRetryAfterMs('garbage', now)).toBeNull();
    expect(parseRetryAfterMs(null, now)).toBeNull();
  });
});
