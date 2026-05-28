import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { cacheGet, cacheSet, cacheKey } from '../lib/redis-cache.js';

// WHY FastifyRequest (not FastifyInstance): cache is a per-request helper that
// reads req.auth.orgId for tenant-scoped keys. Using `this` binding in the
// decorator function is the canonical Fastify pattern for request-scoped helpers.
declare module 'fastify' {
  interface FastifyRequest {
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
  server.decorateRequest('cache', async function <
    T,
  >(this: FastifyRequest, handler: () => Promise<T>, options: { ttlSeconds: number; tags?: string[]; key?: string }): Promise<T> {
    const req = this as FastifyRequest & { auth?: { orgId?: string } };
    const orgId = req.auth?.orgId ?? 'anon';
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
