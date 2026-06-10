// Shared Redis client for the MCP server.
//
// Mirrors apps/api/src/redis.ts so the two services use the same connection
// strategy (short timeouts, no offline queue, single retry). Rate-limiting
// against an unreachable Redis would either fail open (no limit) or fail
// closed (every request 503); the plugin layer chooses which behaviour via
// `skipOnError`.

import Redis from 'ioredis';

const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6380';

export const redis = new Redis(redisUrl, {
  connectTimeout: 1_000,
  enableOfflineQueue: false,
  maxRetriesPerRequest: 1,
  retryStrategy: () => null,
});

let reconnectPromise: Promise<void> | null = null;

export function redisStatusCanRunCommand(status = redis.status): boolean {
  return status === 'ready' || status === 'connect';
}

export function redisStatusCanReconnect(status = redis.status): boolean {
  return status === 'wait' || status === 'close' || status === 'end';
}

/**
 * Reconnect-on-demand. retryStrategy:null means a dropped connection stays
 * dropped ('end') forever — without this helper one Redis blip would leave the
 * fail-closed production rate limiter returning 503 for ALL MCP traffic until
 * a process restart (mirrors apps/api/src/redis.ts; MISTAKES.md 2026-06-07).
 */
export async function ensureRedisReady(): Promise<boolean> {
  if (redisStatusCanRunCommand()) return true;

  if (redisStatusCanReconnect()) {
    reconnectPromise ??= redis.connect().finally(() => {
      reconnectPromise = null;
    });
    try {
      await reconnectPromise;
    } catch {
      return false;
    }
  }

  return redisStatusCanRunCommand();
}

export async function pingRedis(): Promise<boolean> {
  try {
    if (!(await ensureRedisReady())) return false;
    await redis.ping();
    return true;
  } catch {
    return false;
  }
}

redis.on('error', () => {
  // Swallow connection errors here — the rate-limit plugin reports failures
  // through skipOnError, and the /health endpoint surfaces broken state.
});
