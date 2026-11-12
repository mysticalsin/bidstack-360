import { describe, expect, it } from 'vitest';

import {
  RECONNECT_DELAY_CAP_MS,
  redisRetryDelay,
  redisStatusCanReconnect,
  redisStatusCanRunCommand,
} from './redis.js';

describe('Redis reconnect delay', () => {
  it('keeps trying after the old five-attempt budget and caps the wait', () => {
    // WHY: returning null after five tries ended the client during an outage
    // of a few seconds, and start-csv then failed until the process restarted.
    expect(redisRetryDelay(1)).toBe(200);
    expect(redisRetryDelay(6)).toBe(1_200);
    expect(redisRetryDelay(100)).toBe(RECONNECT_DELAY_CAP_MS);
  });
});

describe('Redis connection status helpers', () => {
  it('only runs commands on statuses ioredis can accept immediately', () => {
    expect(redisStatusCanRunCommand('ready')).toBe(true);
    // WHY: ioredis rejects commands until ready when the offline queue is off.
    // Treating connect as ready made the next command fail.
    expect(redisStatusCanRunCommand('connect')).toBe(false);

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
