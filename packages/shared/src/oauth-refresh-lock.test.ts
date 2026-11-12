import { describe, expect, it, vi } from 'vitest';

import { runWithOAuthRefreshLock } from './oauth-refresh-lock.js';

const FALLBACK = 'OAuth refresh Redis lock unavailable; using process-local fallback';

describe('runWithOAuthRefreshLock', () => {
  it('logs the process-local fallback when Redis ready() is false', async () => {
    // WHY: a client that exists but is not ready used to take the in-memory
    // lock with no warning, so an outage looked like a healthy Redis lock.
    const warn = vi.fn();
    const value = await runWithOAuthRefreshLock({
      tokenId: 'ready-false',
      log: { debug: vi.fn(), warn },
      getFreshValue: async () => null,
      refresh: async () => 'fresh',
      redis: {
        ready: async () => false,
        set: async () => 'OK',
        eval: async () => 1,
      },
      redisRequired: false,
    });
    expect(value).toBe('fresh');
    expect(warn.mock.calls.some((call) => call.includes(FALLBACK))).toBe(true);
  });

  it('does not warn when no Redis client was configured', async () => {
    const warn = vi.fn();
    await runWithOAuthRefreshLock({
      tokenId: 'no-redis',
      log: { debug: vi.fn(), warn },
      getFreshValue: async () => 'already',
      refresh: async () => 'fresh',
      redis: null,
      redisRequired: false,
    });
    expect(warn).not.toHaveBeenCalled();
  });
});
