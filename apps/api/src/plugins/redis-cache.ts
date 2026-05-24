import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { cacheGet, cacheSet, cacheKey } from '../lib/redis-cache.js';

declare module 'fastify' {
  interface FastifyInstance {
    cache: <T>(
      handler: () => Promise<T>,
      options: {
        ttlSeconds: number;
        tags?: string[];
        key?: string;
      },
    ) => Promise<T>;
  }
}

export const redisCachePlugin: FastifyPluginAsync = fp(async (server) => {
  server.decorate('cache', async <T>(
    handler: () => Promise<T>,
    options: { ttlSeconds: number; tags?: string[]; key?: string },
  ): Promise<T> => {
    const orgId = (server as unknown as { auth?: { orgId?: string } }).auth?.orgId ?? 'anon';
    const key = options.key ?? cacheKey([orgId, ...(options.tags ?? ['default'])]);

    const cached = await cacheGet<{ data: T; headers?: Record<string, string> }>(key);
    if (cached.hit && cached.data) {
      return cached.data.data;
    }

    const data = await handler();
    await cacheSet(key, { data }, options.ttlSeconds);
    return data;
  });
});
