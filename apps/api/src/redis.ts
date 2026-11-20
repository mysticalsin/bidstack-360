import Redis from 'ioredis';

declare module 'fastify' {
  interface FastifyInstance {
    /** Process Redis client. Routes that queue work use this, not a second client. */
    redis: Redis;
  }
}

const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6380';

// Keep reconnecting after a blip. A five-attempt cap landed the client in
// `end` after about three seconds, and a longer outage then stayed failed
// until the process restarted. The delay is capped so a long outage does not
// back off without bound. Commands still fail fast (`maxRetriesPerRequest: 1`
// + no offline queue). `ensureRedisReady()` still reconnects a client that
// has already stopped. Construction stays synchronous, and `connectTimeout`
// caps each attempt so boot is not blocked.
const RECONNECT_DELAY_STEP_MS = 200;
export const RECONNECT_DELAY_CAP_MS = 2_000;

export function redisRetryDelay(times: number): number {
  return Math.min(times * RECONNECT_DELAY_STEP_MS, RECONNECT_DELAY_CAP_MS);
}

export const redis = new Redis(redisUrl, {
  connectTimeout: 1_000,
  enableOfflineQueue: false,
  maxRetriesPerRequest: 1,
  // TCP keepalive so Azure Cache for Redis' ~10-minute idle reaper doesn't
  // silently drop this long-lived client between requests.
  keepAlive: 30_000,
  retryStrategy: redisRetryDelay,
});

let reconnectPromise: Promise<void> | null = null;

export function redisStatusCanRunCommand(status = redis.status): boolean {
  return status === 'ready';
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
  return waitForRedisClient(redis, timeoutMs);
}

/**
 * Resolve once `client` can run a command, or after `timeoutMs`. A client that
 * has stopped (`wait`, `close`, `end`) is connected again. A client that is
 * already reconnecting is left to finish that attempt.
 */
export function waitForRedisClient(client: Redis, timeoutMs = 5_000): Promise<boolean> {
  const canRun = (): boolean => redisStatusCanRunCommand(client.status);
  if (canRun()) return Promise.resolve(true);
  return new Promise((resolve) => {
    const onUp = (): void => {
      cleanup();
      resolve(true);
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve(canRun());
    }, timeoutMs);
    const cleanup = (): void => {
      clearTimeout(timer);
      client.off('ready', onUp);
    };
    client.once('ready', onUp);
    if (client.status === 'wait' || client.status === 'close' || client.status === 'end') {
      const connecting =
        client === redis
          ? ensureRedisReady()
          : client.connect().then(
              () => undefined,
              () => undefined,
            );
      void connecting.then(() => {
        if (canRun()) onUp();
      });
    }
  });
}

redis.on('error', () => {
  // Prevent unhandled 'error' events; callers such as /health surface status.
});
