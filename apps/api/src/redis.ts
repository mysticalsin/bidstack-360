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
