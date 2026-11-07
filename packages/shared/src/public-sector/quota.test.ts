import { describe, expect, it } from 'vitest';

import { PsSourceError } from './errors.js';
import {
  BULK_QUIET_HOURS,
  CHILE_TIME_ZONE,
  InMemoryQuotaStore,
  MERCADOPUBLICO_DAILY_LIMIT,
  assertBulkWindow,
  createQuotaGuard,
  isWithinQuietHours,
  nextQuietWindowStart,
  quotaDayKey,
} from './quota.js';

describe('Mercado Publico quota guard', () => {
  it('keeps a safety margin under the 10,000 per day ticket limit', async () => {
    // The ticket is personal and shared by every environment that uses it, so
    // running to the published limit would lock the owner out for the day.
    expect(MERCADOPUBLICO_DAILY_LIMIT).toBe(10_000);
    const guard = createQuotaGuard({
      store: new InMemoryQuotaStore(),
      credentialId: 'cfg-1',
      now: () => new Date('2026-11-06T15:00:00Z'),
    });
    expect(guard.ceiling).toBe(8_000);
    for (let i = 0; i < 8_000; i += 1) await guard.reserve();
    await expect(guard.reserve()).rejects.toMatchObject({
      kind: 'quota_exhausted',
      doNotRetry: true,
    });
  });

  it('never lets a configured margin raise the ceiling above the hard limit', () => {
    expect(() =>
      createQuotaGuard({ store: new InMemoryQuotaStore(), credentialId: 'x', safetyMargin: -0.5 }),
    ).toThrow(/safety margin/i);
    expect(() =>
      createQuotaGuard({
        store: new InMemoryQuotaStore(),
        credentialId: 'x',
        dailyLimit: 20_000,
      }),
    ).toThrow(/10000/);
  });

  it('counts per Chile calendar day, not per UTC day', async () => {
    // 02:30 UTC on 7 Nov is still 6 Nov in Santiago (UTC-3 in November).
    expect(quotaDayKey(new Date('2026-11-07T02:30:00Z'))).toBe('2026-11-06');
    expect(quotaDayKey(new Date('2026-11-07T03:30:00Z'))).toBe('2026-11-07');
    const store = new InMemoryQuotaStore();
    let now = new Date('2026-11-07T02:59:00Z');
    const guard = createQuotaGuard({ store, credentialId: 'cfg-1', now: () => now });
    for (let i = 0; i < 8_000; i += 1) await guard.reserve();
    await expect(guard.reserve()).rejects.toBeInstanceOf(PsSourceError);
    now = new Date('2026-11-07T03:01:00Z');
    await expect(guard.reserve()).resolves.toMatchObject({ used: 1 });
  });

  it('keys the counter by credential id, never by the ticket value', async () => {
    const store = new InMemoryQuotaStore();
    const guard = createQuotaGuard({
      store,
      credentialId: 'cfg-1',
      now: () => new Date('2026-11-06T15:00:00Z'),
    });
    await guard.reserve();
    expect(store.keys()).toEqual(['ps:quota:cfg-1:2026-11-06']);
  });
});

describe('bulk quiet hours (22:00 to 07:00 America/Santiago)', () => {
  it('uses the documented window and zone', () => {
    expect(BULK_QUIET_HOURS).toEqual([22, 7]);
    expect(CHILE_TIME_ZONE).toBe('America/Santiago');
  });

  it('is inside the window late evening and early morning in Santiago', () => {
    // November: Santiago is UTC-3.
    expect(isWithinQuietHours(new Date('2026-11-07T01:30:00Z'))).toBe(true); // 22:30
    expect(isWithinQuietHours(new Date('2026-11-07T09:59:00Z'))).toBe(true); // 06:59
    expect(isWithinQuietHours(new Date('2026-11-07T10:00:00Z'))).toBe(false); // 07:00
    expect(isWithinQuietHours(new Date('2026-11-06T19:00:00Z'))).toBe(false); // 16:00
  });

  it('refuses a bulk run in business hours and says when to retry', () => {
    const now = new Date('2026-11-06T19:00:00Z'); // 16:00 Santiago
    expect(nextQuietWindowStart(now).toISOString()).toBe('2026-11-07T01:00:00.000Z');
    try {
      assertBulkWindow(now);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(PsSourceError);
      expect(err).toMatchObject({ kind: 'outside_quiet_hours', doNotRetry: false });
      expect((err as PsSourceError).retryAfterMs).toBe(6 * 60 * 60 * 1000);
    }
    expect(() => assertBulkWindow(new Date('2026-11-07T02:00:00Z'))).not.toThrow();
  });

  it('handles the winter offset (UTC-4) too', () => {
    // July: Santiago is UTC-4, so 22:00 local is 02:00 UTC.
    expect(isWithinQuietHours(new Date('2026-07-15T01:59:00Z'))).toBe(false);
    expect(isWithinQuietHours(new Date('2026-07-15T02:00:00Z'))).toBe(true);
    expect(nextQuietWindowStart(new Date('2026-07-14T20:00:00Z')).toISOString()).toBe(
      '2026-07-15T02:00:00.000Z',
    );
  });
});
