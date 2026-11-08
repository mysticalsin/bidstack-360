import { describe, expect, it, vi } from 'vitest';

import { ProviderRateLimitError, providerFetch, retryAfterMs } from './provider-http.js';

describe('retryAfterMs', () => {
  it('reads Retry-After seconds', () => {
    expect(retryAfterMs('7', 0)).toBe(7_000);
  });

  it('reads Retry-After as an HTTP date', () => {
    const now = Date.parse('2026-11-06T12:00:00Z');
    expect(retryAfterMs('Fri, 06 Nov 2026 12:00:30 GMT', 0, now)).toBe(30_000);
  });

  it('backs off exponentially without a header and caps at 15 minutes', () => {
    expect(retryAfterMs(null, 0)).toBe(30_000);
    expect(retryAfterMs(null, 2)).toBe(120_000);
    expect(retryAfterMs(null, 20)).toBe(15 * 60_000);
  });
});

describe('providerFetch', () => {
  it('turns a 429 into a typed rate limit error carrying the wait', async () => {
    const fetchImpl = vi.fn(async () => new Response('slow down', { status: 429, headers: { 'Retry-After': '12' } }));
    await expect(providerFetch('https://graph.example/x', {}, { provider: 'Microsoft Graph', fetchImpl })).rejects.toMatchObject({
      name: 'ProviderRateLimitError',
      retryAfterMs: 12_000,
      provider: 'Microsoft Graph',
    });
  });

  it('treats a 503 with Retry-After as throttling too', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 503, headers: { 'Retry-After': '3' } }));
    const err = await providerFetch('https://x', {}, { provider: 'Google', fetchImpl }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderRateLimitError);
  });

  it('passes other responses through untouched', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }));
    const res = await providerFetch('https://x', {}, { provider: 'Google', fetchImpl });
    expect(res.status).toBe(200);
  });
});
