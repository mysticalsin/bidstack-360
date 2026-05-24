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

redis.on('error', () => {
  // Swallow connection errors here — the rate-limit plugin reports failures
  // through skipOnError, and the /health endpoint surfaces broken state.
});
