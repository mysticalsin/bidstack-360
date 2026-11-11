import Redis from 'ioredis';

import { createLogger } from './lib/logger.js';

const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6380';

// Reconnect forever with a backoff capped at 2 s. Giving up after a few tries
// left the client in 'end' after an outage of a few seconds, and callers that
// never go through ensureRedisReady() (the rate-limit store) kept failing
// until something else (e.g. /readyz) reconnected it. While reconnecting,
// commands still fail fast (`maxRetriesPerRequest: 1` + no offline queue), so
// an outage is reported, not masked; ensureRedisReady() still reconnects a
// client that was closed explicitly. The eager (non-lazy) connect never blocks
// boot because construction is synchronous and `connectTimeout` caps each attempt.
const RECONNECT_DELAY_STEP_MS = 200;
const RECONNECT_DELAY_CAP_MS = 2_000;

export const redis = new Redis(redisUrl, {
  connectTimeout: 1_000,
  // The two options below only fail fast while disconnected. A Redis that
  // froze after connecting never answers, and cache, idempotency and lock
  // calls inside requests waited forever; this bounds each command.
  commandTimeout: 2_000,
  enableOfflineQueue: false,
  maxRetriesPerRequest: 1,
  // TCP keepalive so Azure Cache for Redis' ~10-minute idle reaper doesn't
  // silently drop this long-lived client between requests.
  keepAlive: 30_000,
  retryStrategy: (times) => Math.min(times * RECONNECT_DELAY_STEP_MS, RECONNECT_DELAY_CAP_MS),
});

let reconnectPromise: Promise<void> | null = null;

export function redisStatusCanRunCommand(status = redis.status): boolean {
  return status === 'ready' || status === 'connect';
}

export function redisStatusCanReconnect(status = redis.status): boolean {
  return status === 'wait' || status === 'close' || status === 'end';
}

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

/**
 * Resolve once Redis can run commands, or after `timeoutMs`. Unlike a bare
 * status check, this AWAITS the in-flight eager connection (status 'connecting'),
 * so a slow connect at boot is not mistaken for a hard failure. Used by the
 * rate-limit store selection so it never falsely trips the production guard.
 */
export function waitForRedisReady(timeoutMs = 5_000): Promise<boolean> {
  if (redisStatusCanRunCommand()) return Promise.resolve(true);
  return new Promise((resolve) => {
    const onUp = (): void => {
      cleanup();
      resolve(true);
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve(redisStatusCanRunCommand());
    }, timeoutMs);
    const cleanup = (): void => {
      clearTimeout(timer);
      redis.off('ready', onUp);
      redis.off('connect', onUp);
    };
    redis.once('ready', onUp);
    redis.once('connect', onUp);
    // If the client has already given up, kick a reconnect attempt.
    if (redisStatusCanReconnect()) {
      void ensureRedisReady().then((ok) => {
        if (ok) onUp();
      });
    }
  });
}

redis.on('error', () => {
  // Prevent unhandled 'error' events; callers such as /health surface status.
});

export const redisLog = createLogger({ name: 'redis' });

// Reconnect attempts come every <= 2 s during an outage; warn on the first
// one and then at most once per interval so the log shows it without flooding.
const RECONNECT_WARN_INTERVAL_MS = 30_000;
let lastReconnectWarnAt: number | null = null;

redis.on('reconnecting', (nextAttemptInMs: number) => {
  const now = Date.now();
  if (lastReconnectWarnAt !== null && now - lastReconnectWarnAt < RECONNECT_WARN_INTERVAL_MS) return;
  lastReconnectWarnAt = now;
  redisLog.warn({ nextAttemptInMs }, 'shared Redis client is reconnecting; Redis-backed calls fail until it is back');
});
