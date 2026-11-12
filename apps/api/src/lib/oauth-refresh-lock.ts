import type pino from 'pino';

import {
  OAuthRefreshLockTimeoutError,
  OAuthRefreshLockUnavailableError,
  isOAuthRefreshLockError,
  runWithOAuthRefreshLock as runSharedLock,
  type OAuthRefreshLockRedis,
} from '@bidstack/shared';

import { ensureRedisReady, redis } from '../redis.js';

export {
  OAuthRefreshLockTimeoutError,
  OAuthRefreshLockUnavailableError,
  isOAuthRefreshLockError,
};

type RefreshLockLogger = Pick<pino.Logger, 'debug' | 'warn'>;

const store: OAuthRefreshLockRedis = {
  ready: () => ensureRedisReady(),
  set: (key, value, expiryMode, ttlMs, condition) =>
    redis.set(key, value, expiryMode, ttlMs, condition),
  eval: (script, numKeys, key, owner) => redis.eval(script, numKeys, key, owner),
};

interface OAuthRefreshLockOptions<T> {
  tokenId: string;
  log: RefreshLockLogger;
  getFreshValue: () => Promise<T | null>;
  refresh: () => Promise<T>;
}

/** The API's Redis client, and the same lock the worker uses. */
export async function runWithOAuthRefreshLock<T>({
  tokenId,
  log,
  getFreshValue,
  refresh,
}: OAuthRefreshLockOptions<T>): Promise<T> {
  return runSharedLock({
    tokenId,
    log,
    getFreshValue,
    refresh,
    redis: store,
    redisRequired:
      process.env.OAUTH_REFRESH_LOCK_REDIS_REQUIRED !== 'false' &&
      process.env.NODE_ENV === 'production',
  });
}
