import { afterEach, describe, expect, it, vi } from 'vitest';

import { redisStatusCanReconnect, redisStatusCanRunCommand } from './redis.js';

describe('Redis connection status helpers', () => {
  it('only runs commands on statuses ioredis can accept immediately', () => {
    expect(redisStatusCanRunCommand('ready')).toBe(true);
    expect(redisStatusCanRunCommand('connect')).toBe(true);

    expect(redisStatusCanRunCommand('wait')).toBe(false);
    expect(redisStatusCanRunCommand('close')).toBe(false);
    expect(redisStatusCanRunCommand('end')).toBe(false);
  });

  it('marks ended local clients as reconnectable for readiness and cache calls', () => {
    expect(redisStatusCanReconnect('wait')).toBe(true);
    expect(redisStatusCanReconnect('close')).toBe(true);
    expect(redisStatusCanReconnect('end')).toBe(true);

    expect(redisStatusCanReconnect('ready')).toBe(false);
    expect(redisStatusCanReconnect('connect')).toBe(false);
    expect(redisStatusCanReconnect('reconnecting')).toBe(false);
  });
});

describe('shared Redis client reconnect warning', () => {
  const previousUrl = process.env.REDIS_URL;
  let disconnect: (() => void) | null = null;

  afterEach(() => {
    disconnect?.();
    disconnect = null;
    vi.useRealTimers();
    process.env.REDIS_URL = previousUrl;
    if (previousUrl === undefined) delete process.env.REDIS_URL;
  });

  it('warns while reconnecting at most once per 30 s, so an outage is visible without flooding the log', async () => {
    const start = Date.parse('2026-11-09T00:00:00Z');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(start);
    // Port 9 (discard) on loopback is closed here; real reconnect events may
    // also fire, and they share the frozen clock, so the counts below hold.
    process.env.REDIS_URL = 'redis://127.0.0.1:9';
    vi.resetModules();
    const { redis, redisLog } = await import('./redis.js');
    disconnect = () => redis.disconnect();
    const warn = vi.spyOn(redisLog, 'warn').mockImplementation(() => undefined);

    redis.emit('reconnecting', 200);
    redis.emit('reconnecting', 400);
    vi.setSystemTime(start + 29_999);
    redis.emit('reconnecting', 2_000);
    expect(warn).toHaveBeenCalledTimes(1);

    vi.setSystemTime(start + 30_000);
    redis.emit('reconnecting', 2_000);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[0]?.[1]).toMatch(/reconnecting/);
  });
});
