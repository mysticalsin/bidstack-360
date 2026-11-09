import { afterEach, describe, expect, it, vi } from 'vitest';

import { startFrozenRedis, type FrozenRedis } from './test-support/frozen-redis.js';

// WHY: the shared client backs the response cache, idempotency keys and
// locks, and every successful mutation awaits invalidateOrgCache before the
// response is sent. Against a Redis that froze after connecting, commands
// never settled, so POST /companies hung after its rows committed and a client
// retry created a duplicate (QA F1, reproduced live with SIGSTOP).
const ORG = '00000000-0000-4000-8000-000000000001';
const previousUrl = process.env.REDIS_URL;
let frozen: FrozenRedis | null = null;
let disconnect: (() => void) | null = null;

async function loadAgainstFrozenRedis() {
  frozen = await startFrozenRedis();
  process.env.REDIS_URL = `redis://127.0.0.1:${frozen.port}`;
  vi.resetModules();
  const { redis } = await import('./redis.js');
  disconnect = () => redis.disconnect();
  for (let i = 0; i < 50 && redis.status !== 'ready'; i++) await new Promise((r) => setTimeout(r, 20));
  expect(redis.status).toBe('ready');
  return import('./lib/redis-cache.js');
}

describe('shared Redis client against a Redis that froze after connecting', () => {
  afterEach(async () => {
    disconnect?.();
    disconnect = null;
    await frozen?.close();
    frozen = null;
    process.env.REDIS_URL = previousUrl;
    if (previousUrl === undefined) delete process.env.REDIS_URL;
  });

  it('lets a mutation finish its cache invalidation within a bound', async () => {
    const { invalidateOrgCache } = await loadAgainstFrozenRedis();
    const started = Date.now();

    await invalidateOrgCache(ORG);

    expect(Date.now() - started).toBeLessThan(3_000);
    expect(frozen?.received).toContain('SMEMBERS');
  }, 15_000);

  it('treats a cache read that never answers as a miss', async () => {
    const { cacheGet } = await loadAgainstFrozenRedis();
    const started = Date.now();

    await expect(cacheGet('bidstack:cache:frozen-test')).resolves.toEqual({ hit: false, data: null });

    expect(Date.now() - started).toBeLessThan(3_000);
  }, 15_000);
});
