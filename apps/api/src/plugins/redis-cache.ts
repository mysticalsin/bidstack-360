import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { cacheGet, cacheSet, cacheKey, bodyHash, cacheDel } from '../lib/redis-cache.js';

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

    // Hash query, params, and body to differentiate cache keys
    const payload = {
      query: req.query,
      params: req.params,
      body: req.body,
    };
    const payloadHash = bodyHash(payload);

    const key = options.key ?? cacheKey([orgId, ...(options.tags ?? ['default']), payloadHash]);

    const cached = await cacheGet<{ data: T; headers?: Record<string, string> }>(key);
    if (cached.hit && cached.data) {
      return cached.data.data;
    }

    const data = await handler();
    await cacheSet(key, { data }, options.ttlSeconds);
    return data;
  });

  server.addHook('onResponse', async (req, reply) => {
    // WHY: onResponse fires before auth for public routes (health, webhooks).
    // FastifyRequest.auth is non-optional by contract on protected routes, but
    // we can't guarantee it's set here, so we read it defensively via cast.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const orgId = (req as any).auth?.orgId as string | undefined;
    if (!orgId) return;

    const method = req.method;
    const isMutation = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
    const isSuccess = reply.statusCode >= 200 && reply.statusCode < 300;

    if (isMutation && isSuccess) {
      // Invalidate all cache keys for this tenant orgId
      await cacheDel(`bidstack:cache:${orgId}:*`);
    }
  });
});
