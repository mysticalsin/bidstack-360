import Redis from 'ioredis';

const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6380';

export const redis = new Redis(redisUrl, {
  connectTimeout: 1_000,
  enableOfflineQueue: false,
  maxRetriesPerRequest: 1,
  retryStrategy: () => null,
});

redis.on('error', () => {
  // Prevent unhandled 'error' events; callers such as /health surface status.
});
