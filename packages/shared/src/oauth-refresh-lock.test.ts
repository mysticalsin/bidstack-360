import { describe, expect, it, vi } from 'vitest';

import {
  OAuthRefreshLockTimeoutError,
  OAuthRefreshLockUnavailableError,
  oauthRefreshLockRedisRequired,
  oauthRefreshLockStartupError,
  runWithOAuthRefreshLock,
} from './oauth-refresh-lock.js';

const FALLBACK = 'OAuth refresh Redis lock unavailable; using process-local fallback';

describe('oauthRefreshLockRedisRequired', () => {
  it('requires Redis in every mode until the one opt-out is set', () => {
    expect(oauthRefreshLockRedisRequired({})).toBe(true);
    expect(oauthRefreshLockRedisRequired({ NODE_ENV: 'production' })).toBe(true);
    expect(oauthRefreshLockRedisRequired({ NODE_ENV: 'development' })).toBe(true);
    expect(oauthRefreshLockRedisRequired({ NODE_ENV: 'test' })).toBe(true);
    expect(oauthRefreshLockRedisRequired({ OAUTH_REFRESH_LOCK_REDIS_REQUIRED: 'false' })).toBe(
      false,
    );
    expect(
      oauthRefreshLockRedisRequired({
        NODE_ENV: 'production',
        OAUTH_REFRESH_LOCK_REDIS_REQUIRED: 'false',
      }),
    ).toBe(false);
    expect(
      oauthRefreshLockRedisRequired({
        NODE_ENV: 'development',
        OAUTH_REFRESH_LOCK_REDIS_REQUIRED: 'false',
      }),
    ).toBe(false);
  });

  it('refuses startup in production when the opt-out is set', () => {
    // WHY: the lock follows the one variable in every mode. Production must
    // not boot with that variable set, or a deployed process would refresh
    // tokens with a process-local lock.
    const refused = 'OAUTH_REFRESH_LOCK_REDIS_REQUIRED=false is refused when NODE_ENV=production';
    expect(
      oauthRefreshLockStartupError({
        NODE_ENV: 'production',
        OAUTH_REFRESH_LOCK_REDIS_REQUIRED: 'false',
      }),
    ).toBe(refused);
    expect(oauthRefreshLockStartupError({})).toBeNull();
    expect(oauthRefreshLockStartupError({ NODE_ENV: 'production' })).toBeNull();
    expect(
      oauthRefreshLockStartupError({
        NODE_ENV: 'development',
        OAUTH_REFRESH_LOCK_REDIS_REQUIRED: 'false',
      }),
    ).toBeNull();
    expect(
      oauthRefreshLockStartupError({
        NODE_ENV: 'test',
        OAUTH_REFRESH_LOCK_REDIS_REQUIRED: 'false',
      }),
    ).toBeNull();
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
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls.some((call) => call.includes(FALLBACK))).toBe(true);
  });

  it('refuses a lock ttl that does not outlive the refresh', async () => {
    // WHY: the holder can still be talking to the provider when the key
    // expires. The waiter check does not cover that.
    const previousTtl = process.env.OAUTH_REFRESH_LOCK_TTL_MS;
    const previousWait = process.env.OAUTH_REFRESH_LOCK_WAIT_MS;
    const previousTimeout = process.env.OAUTH_HTTP_TIMEOUT_MS;
    process.env.OAUTH_REFRESH_LOCK_TTL_MS = '20000';
    process.env.OAUTH_REFRESH_LOCK_WAIT_MS = '10000';
    process.env.OAUTH_HTTP_TIMEOUT_MS = '20000';
    try {
      await expect(
        runWithOAuthRefreshLock({
          tokenId: 'ttl-not-longer-than-refresh',
          log: { debug: vi.fn(), warn: vi.fn() },
          getFreshValue: async () => null,
          refresh: async () => 'fresh',
          redis: {
            ready: async () => true,
            set: async () => 'OK',
            eval: async () => 1,
          },
          redisRequired: true,
        }),
      ).rejects.toThrow('OAUTH_REFRESH_LOCK_TTL_MS must be greater than OAUTH_HTTP_TIMEOUT_MS');
    } finally {
      if (previousTtl === undefined) delete process.env.OAUTH_REFRESH_LOCK_TTL_MS;
      else process.env.OAUTH_REFRESH_LOCK_TTL_MS = previousTtl;
      if (previousWait === undefined) delete process.env.OAUTH_REFRESH_LOCK_WAIT_MS;
      else process.env.OAUTH_REFRESH_LOCK_WAIT_MS = previousWait;
      if (previousTimeout === undefined) delete process.env.OAUTH_HTTP_TIMEOUT_MS;
      else process.env.OAUTH_HTTP_TIMEOUT_MS = previousTimeout;
    }
  });

  it('refuses a waiter that is at least as long as the lock ttl', async () => {
    const previousTtl = process.env.OAUTH_REFRESH_LOCK_TTL_MS;
    const previousWait = process.env.OAUTH_REFRESH_LOCK_WAIT_MS;
    process.env.OAUTH_REFRESH_LOCK_TTL_MS = '300';
    process.env.OAUTH_REFRESH_LOCK_WAIT_MS = '300';
    try {
      await expect(
        runWithOAuthRefreshLock({
          tokenId: 'ttl-not-longer',
          log: { debug: vi.fn(), warn: vi.fn() },
          getFreshValue: async () => null,
          refresh: async () => 'fresh',
          redis: {
            ready: async () => true,
            set: async () => 'OK',
            eval: async () => 1,
          },
          redisRequired: true,
        }),
      ).rejects.toThrow('OAUTH_REFRESH_LOCK_TTL_MS must be greater than OAUTH_REFRESH_LOCK_WAIT_MS');
    } finally {
      if (previousTtl === undefined) delete process.env.OAUTH_REFRESH_LOCK_TTL_MS;
      else process.env.OAUTH_REFRESH_LOCK_TTL_MS = previousTtl;
      if (previousWait === undefined) delete process.env.OAUTH_REFRESH_LOCK_WAIT_MS;
      else process.env.OAUTH_REFRESH_LOCK_WAIT_MS = previousWait;
    }
  });

  it('times out at the waiter while the lock ttl stays longer', async () => {
    // WHY: the lock key has to outlive the waiter. A waiter that waits at
    // least as long as the TTL can take the key while the previous holder
    // still owns the refresh.
    const previousTtl = process.env.OAUTH_REFRESH_LOCK_TTL_MS;
    const previousWait = process.env.OAUTH_REFRESH_LOCK_WAIT_MS;
    const previousPoll = process.env.OAUTH_REFRESH_LOCK_POLL_MS;
    const previousTimeout = process.env.OAUTH_HTTP_TIMEOUT_MS;
    process.env.OAUTH_REFRESH_LOCK_TTL_MS = '300';
    process.env.OAUTH_REFRESH_LOCK_WAIT_MS = '40';
    process.env.OAUTH_REFRESH_LOCK_POLL_MS = '20';
    process.env.OAUTH_HTTP_TIMEOUT_MS = '50';
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
      if (previousTimeout === undefined) delete process.env.OAUTH_HTTP_TIMEOUT_MS;
      else process.env.OAUTH_HTTP_TIMEOUT_MS = previousTimeout;
    }
    expect(caught).toBeInstanceOf(OAuthRefreshLockTimeoutError);
    expect((caught as OAuthRefreshLockTimeoutError).waitMs).toBe(40);
    const elapsed = Date.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(40);
    expect(elapsed).toBeLessThan(280);
  });

  it('warns when the memory lock is used because no Redis client was configured', async () => {
    // WHY: a missing client is a fallback, the same as a client that is not
    // ready. A silent fallback hides an outage.
    const warn = vi.fn();
    const value = await runWithOAuthRefreshLock({
      tokenId: 'no-redis',
      log: { debug: vi.fn(), warn },
      getFreshValue: async () => 'already',
      refresh: async () => 'fresh',
      redis: null,
      redisRequired: false,
    });
    expect(value).toBe('already');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls.some((call) => call.includes(FALLBACK))).toBe(true);
  });

  it('does not warn when Redis is required and unavailable', async () => {
    const warn = vi.fn();
    await expect(
      runWithOAuthRefreshLock({
        tokenId: 'required-down',
        log: { debug: vi.fn(), warn },
        getFreshValue: async () => null,
        refresh: async () => 'fresh',
        redis: null,
        redisRequired: true,
      }),
    ).rejects.toBeInstanceOf(OAuthRefreshLockUnavailableError);
    expect(warn).not.toHaveBeenCalled();
  });
});
