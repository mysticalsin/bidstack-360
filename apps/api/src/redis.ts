import Redis from 'ioredis';

const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6380';

// Bounded auto-reconnect: a transient blip should self-heal without waiting for
// the next on-demand `ensureRedisReady()` call, but the client must still give
// up after a few tries so it lands in an `end` state that `ensureRedisReady()`
// can reconnect (rather than retrying forever and masking a real outage).
// Commands still fail fast (`maxRetriesPerRequest: 1` + no offline queue), and
// the eager (non-lazy) connect never blocks boot because construction is
// synchronous and `connectTimeout` caps each attempt.
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY_STEP_MS = 200;
const RECONNECT_DELAY_CAP_MS = 2_000;

export const redis = new Redis(redisUrl, {
  connectTimeout: 1_000,
  enableOfflineQueue: false,
  maxRetriesPerRequest: 1,
  retryStrategy: (times) =>
    times > MAX_RECONNECT_ATTEMPTS
      ? null
      : Math.min(times * RECONNECT_DELAY_STEP_MS, RECONNECT_DELAY_CAP_MS),
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

redis.on('error', () => {
  // Prevent unhandled 'error' events; callers such as /health surface status.
});
