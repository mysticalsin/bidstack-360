// v22.1: GDELT backoff carries across runs and pacing stays polite.
import { describe, expect, it } from 'vitest';

import { memoryNewsCache } from './news.js';
import { GDELT_BACKOFF_KEY, gdeltBackoffMs, runNewsScan } from './news-scan.js';

const HOUR = 3_600_000;
const company = (id: string) => ({
  id,
  orgId: 'o1',
  name: `Acme ${id}`,
  domain: `acme-${id}.com`,
  keyAccountOwnerId: null,
  firmographics: null,
  accountWatchSubjects: [],
});

function fakeDb(n = 2) {
  return {
    company: { findMany: async () => Array.from({ length: n }, (_, i) => company(`c${i}`)) },
    opportunity: { findMany: async () => [] },
    accountWatchEvent: { findMany: async () => [], createMany: async () => ({ count: 0 }), update: async () => ({}) },
    notification: { createMany: async () => ({ count: 0 }) },
  } as never;
}

function fetchFake(gdeltStatus: number) {
  const calls: string[] = [];
  const impl = async (url: string) => {
    calls.push(url);
    if (url.includes('gdeltproject')) return new Response(gdeltStatus === 200 ? '{"articles":[]}' : 'slow down', { status: gdeltStatus });
    return new Response('<rss><channel></channel></rss>', { status: 200, headers: { 'content-type': 'application/rss+xml' } });
  };
  return { calls, impl: impl as never };
}

describe('runNewsScan GDELT backoff', () => {
  const env = { WATCHDOG_NEWS_SOURCES: 'gdelt,google_news', WATCHDOG_NEWS_VERIFY_BODY: 'false' };

  it('grows 1h, 2h, 4h and caps at 24h', () => {
    expect([1, 2, 3, 6, 9].map((l) => gdeltBackoffMs(l) / HOUR)).toEqual([1, 2, 4, 24, 24]);
  });

  it('stops GDELT for the run after a 429, then skips it next run until the backoff ends', async () => {
    const cache = memoryNewsCache();
    const sleeps: number[] = [];
    const now = new Date('2026-11-01T03:00:00Z');
    const f1 = fetchFake(429);
    const s1 = await runNewsScan({ db: fakeDb(), env, cache, fetchImpl: f1.impl, now, sleep: async (ms) => void sleeps.push(ms) });
    expect(s1.gdelt).toMatchObject({ state: 'rate_limited', level: 1 });
    expect(f1.calls.filter((u) => u.includes('gdeltproject'))).toHaveLength(1);
    // GDELT pacing while it was on, then normal pacing.
    expect(sleeps[0]).toBe(5_000);
    expect(JSON.parse((await cache.get(GDELT_BACKOFF_KEY))!)).toEqual({ level: 1, until: now.getTime() + HOUR });

    const f2 = fetchFake(200);
    const s2 = await runNewsScan({ db: fakeDb(), env, cache, fetchImpl: f2.impl, now: new Date(now.getTime() + 30 * 60_000), sleep: async () => undefined });
    expect(s2.gdelt.state).toBe('backoff');
    expect(f2.calls.some((u) => u.includes('gdeltproject'))).toBe(false);
  });

  it('tries again after the backoff, paces 10s between accounts and resets on success', async () => {
    const cache = memoryNewsCache();
    const now = new Date('2026-11-01T09:00:00Z');
    await cache.set(GDELT_BACKOFF_KEY, JSON.stringify({ level: 3, until: now.getTime() - 1 }), 3600);
    const sleeps: number[] = [];
    const f = fetchFake(200);
    const s = await runNewsScan({ db: fakeDb(), env, cache, fetchImpl: f.impl, now, sleep: async (ms) => void sleeps.push(ms) });
    expect(s.gdelt).toEqual({ state: 'ok', level: 0, until: null });
    expect(sleeps).toContain(10_000);
    expect(f.calls.filter((u) => u.includes('gdeltproject'))).toHaveLength(2);
    expect(JSON.parse((await cache.get(GDELT_BACKOFF_KEY))!)).toEqual({ level: 0, until: 0 });
  });

  it('a second 429 doubles the wait', async () => {
    const cache = memoryNewsCache();
    const now = new Date('2026-11-01T09:00:00Z');
    await cache.set(GDELT_BACKOFF_KEY, JSON.stringify({ level: 1, until: now.getTime() - 1 }), 3600);
    const s = await runNewsScan({ db: fakeDb(1), env, cache, fetchImpl: fetchFake(429).impl, now, sleep: async () => undefined });
    expect(s.gdelt).toEqual({ state: 'rate_limited', level: 2, until: new Date(now.getTime() + 2 * HOUR).toISOString() });
  });
});
