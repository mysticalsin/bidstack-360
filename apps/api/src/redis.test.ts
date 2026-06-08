import { describe, expect, it } from 'vitest';

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
