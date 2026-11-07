import { describe, expect, it } from 'vitest';

import {
  DEFAULT_WEBHOOK_RETRY_POLICY,
  WEBHOOK_BODY_CAP_BYTES,
  WebhookRetryPolicySchema,
  capWebhookText,
  isRetryableWebhookStatus,
  maskWebhookSignature,
  parseRetryAfterMs,
  redactWebhookText,
  webhookRetryDelayMs,
  webhookRetrySchedule,
} from './webhook-delivery-policy.js';

describe('webhook retry policy', () => {
  it('defaults to the schedule production already runs (5 attempts, exponential from 30 s, 10 s timeout)', () => {
    // WHY: an endpoint with no saved policy must behave exactly like before
    // slice 4, so turning the editor on changes nothing for existing partners.
    expect(DEFAULT_WEBHOOK_RETRY_POLICY).toEqual({
      maxAttempts: 5,
      backoffStrategy: 'exponential',
      backoffBaseSeconds: 30,
      timeoutMs: 10_000,
    });
    expect(webhookRetrySchedule(DEFAULT_WEBHOOK_RETRY_POLICY).map((s) => s.delayMs)).toEqual([
      0, 30_000, 60_000, 120_000, 240_000,
    ]);
  });

  it('computes linear and fixed curves and accumulates the offset of each attempt', () => {
    const linear = webhookRetrySchedule({ ...DEFAULT_WEBHOOK_RETRY_POLICY, backoffStrategy: 'linear', maxAttempts: 4, backoffBaseSeconds: 10 });
    expect(linear.map((s) => s.delayMs)).toEqual([0, 10_000, 20_000, 30_000]);
    expect(linear.map((s) => s.atMs)).toEqual([0, 10_000, 30_000, 60_000]);
    const fixed = webhookRetrySchedule({ ...DEFAULT_WEBHOOK_RETRY_POLICY, backoffStrategy: 'fixed', maxAttempts: 3, backoffBaseSeconds: 60 });
    expect(fixed.map((s) => s.delayMs)).toEqual([0, 60_000, 60_000]);
  });

  it('caps a single delay at six hours so a large base cannot park a message for days', () => {
    const p = { ...DEFAULT_WEBHOOK_RETRY_POLICY, maxAttempts: 10, backoffBaseSeconds: 3600 };
    expect(webhookRetryDelayMs(p, 9)).toBe(6 * 3600_000);
  });

  it('rejects out-of-range policies at the schema boundary', () => {
    expect(WebhookRetryPolicySchema.safeParse({ ...DEFAULT_WEBHOOK_RETRY_POLICY, maxAttempts: 11 }).success).toBe(false);
    expect(WebhookRetryPolicySchema.safeParse({ ...DEFAULT_WEBHOOK_RETRY_POLICY, maxAttempts: 0 }).success).toBe(false);
    expect(WebhookRetryPolicySchema.safeParse({ ...DEFAULT_WEBHOOK_RETRY_POLICY, timeoutMs: 60_000 }).success).toBe(false);
    expect(WebhookRetryPolicySchema.safeParse({ ...DEFAULT_WEBHOOK_RETRY_POLICY, backoffBaseSeconds: 1 }).success).toBe(false);
    expect(WebhookRetryPolicySchema.safeParse({ ...DEFAULT_WEBHOOK_RETRY_POLICY, backoffStrategy: 'random' }).success).toBe(false);
    expect(WebhookRetryPolicySchema.safeParse(DEFAULT_WEBHOOK_RETRY_POLICY).success).toBe(true);
  });
});

describe('retryable responses', () => {
  it('does not retry client errors a retry cannot fix', () => {
    for (const s of [400, 401, 403, 404, 410, 422]) expect(isRetryableWebhookStatus(s)).toBe(false);
  });
  it('retries timeouts, rate limits, server errors and network failures', () => {
    for (const s of [408, 429, 500, 502, 503, 504]) expect(isRetryableWebhookStatus(s)).toBe(true);
    expect(isRetryableWebhookStatus(null)).toBe(true);
  });
  it('reads Retry-After as seconds or an HTTP date, capped at one hour', () => {
    const now = Date.parse('2026-11-07T12:00:00Z');
    expect(parseRetryAfterMs('120', now)).toBe(120_000);
    expect(parseRetryAfterMs('Sat, 07 Nov 2026 12:00:30 GMT', now)).toBe(30_000);
    expect(parseRetryAfterMs('999999', now)).toBe(3600_000);
    expect(parseRetryAfterMs('soon', now)).toBeNull();
    expect(parseRetryAfterMs(null, now)).toBeNull();
  });
});

describe('stored request and response text', () => {
  it('masks the HMAC in a signature header and keeps the timestamp', () => {
    expect(maskWebhookSignature('t=1700000000,v1=abcdef0123456789')).toBe('t=1700000000,v1=****');
    expect(maskWebhookSignature('t=1,v1=aa,v1=bb')).toBe('t=1,v1=****,v1=****');
  });

  it('redacts secrets, tokens and passwords in JSON and bearer headers', () => {
    const text = JSON.stringify({
      ok: true,
      token: 'tok_live_123',
      nested: { password: 'hunter2', apiKey: 'k-1', client_secret: 'cs' },
      signing: 'whsec_abcDEF123',
    });
    const out = redactWebhookText(`${text} Authorization: Bearer eyJhbGciOi.xyz`);
    for (const leaked of ['tok_live_123', 'hunter2', 'k-1', '"cs"', 'whsec_abcDEF123', 'eyJhbGciOi.xyz']) {
      expect(out).not.toContain(leaked);
    }
    expect(out).toContain('"ok":true');
  });

  it('caps stored text by UTF-8 bytes and says so', () => {
    const big = 'é'.repeat(WEBHOOK_BODY_CAP_BYTES);
    const capped = capWebhookText(big);
    expect(capped.truncated).toBe(true);
    expect(Buffer.byteLength(capped.text, 'utf8')).toBeLessThanOrEqual(WEBHOOK_BODY_CAP_BYTES);
    expect(capWebhookText('short')).toEqual({ text: 'short', truncated: false });
  });
});
