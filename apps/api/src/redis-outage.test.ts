import { describe, expect, it } from 'vitest';

import { redisOutagePort } from './redis-outage.js';

describe('redis outage target', () => {
  it('stops only an opted-in loopback redis', () => {
    // WHY: the outage test shut down whatever REDIS_URL pointed at, including
    // a shared server, and then daemonized a replacement.
    expect(redisOutagePort('redis://127.0.0.1:6380', true)).toBe(6380);
    expect(redisOutagePort('redis://localhost:6380', true)).toBe(6380);
    expect(redisOutagePort('redis://127.0.0.1:6380', false)).toBeNull();
    expect(redisOutagePort('redis://10.0.0.4:6379', true)).toBeNull();
    expect(redisOutagePort('rediss://127.0.0.1:6380', true)).toBeNull();
  });
});
