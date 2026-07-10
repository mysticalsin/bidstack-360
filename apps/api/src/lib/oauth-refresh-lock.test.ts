import type { Logger as PinoLogger } from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  ensureRedisReady: vi.fn(),
  eval: vi.fn(),
  set: vi.fn(),
}));

vi.mock('../redis.js', () => ({
  ensureRedisReady: mocks.ensureRedisReady,
  redis: {
    eval: mocks.eval,
    set: mocks.set,
  },
}));

import { OAuthRefreshLockUnavailableError, runWithOAuthRefreshLock } from './oauth-refresh-lock.js';

const OLD_ENV = { ...process.env };
const log = {
  debug: vi.fn(),
  warn: vi.fn(),
} as unknown as PinoLogger;

beforeEach(() => {
  vi.clearAllMocks();
  process.env = {
    ...OLD_ENV,
    NODE_ENV: 'test',
    OAUTH_REFRESH_LOCK_POLL_MS: '1',
    OAUTH_REFRESH_LOCK_WAIT_MS: '50',
    OAUTH_REFRESH_LOCK_TTL_MS: '500',
  };
  mocks.ensureRedisReady.mockResolvedValue(true);
  mocks.set.mockResolvedValue('OK');
  mocks.eval.mockResolvedValue(1);
});

afterEach(() => {
  process.env = OLD_ENV;
});

describe('runWithOAuthRefreshLock', () => {
  it('refreshes while holding a Redis owner lock and releases it afterward', async () => {
    const refresh = vi.fn().mockResolvedValue('new-access-token');

    await expect(
      runWithOAuthRefreshLock({
        tokenId: 'token-acquire',
        log,
        getFreshValue: vi.fn().mockResolvedValue(null),
        refresh,
      }),
    ).resolves.toBe('new-access-token');

    expect(mocks.set).toHaveBeenCalledWith(
      'bidstack:oauth-refresh-lock:token-acquire',
      expect.any(String),
      'PX',
      500,
      'NX',
    );
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(mocks.eval).toHaveBeenCalledWith(
      expect.any(String),
      1,
      'bidstack:oauth-refresh-lock:token-acquire',
      expect.any(String),
    );
  });

  it('returns a fresh token without refreshing when another request already updated it', async () => {
    const refresh = vi.fn();

    await expect(
      runWithOAuthRefreshLock({
        tokenId: 'token-fresh-after-lock',
        log,
        getFreshValue: vi.fn().mockResolvedValue('fresh-access-token'),
        refresh,
      }),
    ).resolves.toBe('fresh-access-token');

    expect(refresh).not.toHaveBeenCalled();
    expect(mocks.eval).toHaveBeenCalled();
  });

  it('waits behind an in-flight refresh and reuses the saved token', async () => {
    mocks.set.mockResolvedValueOnce(null);
    const refresh = vi.fn();
    const getFreshValue = vi
      .fn<() => Promise<string | null>>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('fresh-from-peer');

    await expect(
      runWithOAuthRefreshLock({
        tokenId: 'token-waiter',
        log,
        getFreshValue,
        refresh,
      }),
    ).resolves.toBe('fresh-from-peer');

    expect(refresh).not.toHaveBeenCalled();
    expect(mocks.eval).not.toHaveBeenCalled();
  });

  it('fails closed in production when Redis locking is required but unavailable', async () => {
    process.env.NODE_ENV = 'production';
    mocks.ensureRedisReady.mockResolvedValue(false);

    await expect(
      runWithOAuthRefreshLock({
        tokenId: 'token-prod',
        log,
        getFreshValue: vi.fn().mockResolvedValue(null),
        refresh: vi.fn(),
      }),
    ).rejects.toBeInstanceOf(OAuthRefreshLockUnavailableError);
  });
});
