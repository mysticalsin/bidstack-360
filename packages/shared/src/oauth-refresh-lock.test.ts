import { describe, expect, it, vi } from 'vitest';

import {
  OAuthRefreshLockTimeoutError,
  oauthRefreshLockRedisRequired,
  runWithOAuthRefreshLock,
} from './oauth-refresh-lock.js';

const FALLBACK = 'OAuth refresh Redis lock unavailable; using process-local fallback';

describe('oauthRefreshLockRedisRequired', () => {
  it('requires Redis when NODE_ENV is missing, even if the opt-out is set', () => {
    expect(oauthRefreshLockRedisRequired({})).toBe(true);
    expect(oauthRefreshLockRedisRequired({ OAUTH_REFRESH_LOCK_REDIS_REQUIRED: 'false' })).toBe(true);
    expect(oauthRefreshLockRedisRequired({ NODE_ENV: 'production' })).toBe(true);
    expect(
      oauthRefreshLockRedisRequired({
        NODE_ENV: 'production',
        OAUTH_REFRESH_LOCK_REDIS_REQUIRED: 'false',
      }),
    ).toBe(true);
    expect(oauthRefreshLockRedisRequired({ NODE_ENV: 'development' })).toBe(true);
    expect(oauthRefreshLockRedisRequired({ NODE_ENV: 'test' })).toBe(true);
  });

  it('allows the in-memory lock only for development or test with an explicit opt-out', () => {
    expect(
      oauthRefreshLockRedisRequired({
        NODE_ENV: 'development',
        OAUTH_REFRESH_LOCK_REDIS_REQUIRED: 'false',
      }),
    ).toBe(false);
    expect(
      oauthRefreshLockRedisRequired({
        NODE_ENV: 'test',
        OAUTH_REFRESH_LOCK_REDIS_REQUIRED: 'false',
      }),
    ).toBe(false);
  });
});

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

  it('waits at least as long as a persisted lock can live', async () => {
    // WHY: the lock key lasts 30s and the waiter gave up at 10s. With Redis
    // persistence that key outlives the process, so every later refresh in
    // the gap also gives up. The waiter has to outlast the key. The TTL stays
    // above a provider refresh; shortening it would let a live refresh lose
    // the lock.
    const previousTtl = process.env.OAUTH_REFRESH_LOCK_TTL_MS;
    const previousWait = process.env.OAUTH_REFRESH_LOCK_WAIT_MS;
    const previousPoll = process.env.OAUTH_REFRESH_LOCK_POLL_MS;
    process.env.OAUTH_REFRESH_LOCK_TTL_MS = '300';
    process.env.OAUTH_REFRESH_LOCK_WAIT_MS = '40';
    process.env.OAUTH_REFRESH_LOCK_POLL_MS = '20';
    const started = Date.now();
    let caught: unknown;
    try {
      await runWithOAuthRefreshLock({
        tokenId: 'stale-window',
        log: { debug: vi.fn(), warn: vi.fn() },
        getFreshValue: async () => null,
        refresh: async () => 'not-used',
        redis: {
          ready: async () => true,
          set: async () => null,
          eval: async () => 0,
        },
        redisRequired: true,
      });
    } catch (err) {
      caught = err;
    } finally {
      if (previousTtl === undefined) delete process.env.OAUTH_REFRESH_LOCK_TTL_MS;
      else process.env.OAUTH_REFRESH_LOCK_TTL_MS = previousTtl;
      if (previousWait === undefined) delete process.env.OAUTH_REFRESH_LOCK_WAIT_MS;
      else process.env.OAUTH_REFRESH_LOCK_WAIT_MS = previousWait;
      if (previousPoll === undefined) delete process.env.OAUTH_REFRESH_LOCK_POLL_MS;
      else process.env.OAUTH_REFRESH_LOCK_POLL_MS = previousPoll;
    }
    expect(caught).toBeInstanceOf(OAuthRefreshLockTimeoutError);
    expect((caught as OAuthRefreshLockTimeoutError).waitMs).toBeGreaterThanOrEqual(300);
    expect(Date.now() - started).toBeGreaterThanOrEqual(280);
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
