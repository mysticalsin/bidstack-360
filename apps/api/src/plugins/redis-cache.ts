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

type RedisCachePluginOptions = {
  enabledInTest?: boolean;
};

const redisCachePluginImpl: FastifyPluginAsync<RedisCachePluginOptions> = async (
  server,
  pluginOptions,
) => {
  const inFlightReads = new Map<string, Promise<unknown>>();
  const bypassRouteCache = process.env.NODE_ENV === 'test' && pluginOptions.enabledInTest !== true;

  server.decorateRequest('cache', async function <
    T,
  >(this: FastifyRequest, handler: () => Promise<T>, options: { ttlSeconds: number; tags?: string[]; key?: string }): Promise<T> {
    if (bypassRouteCache) {
      return handler();
    }

    const req = this as FastifyRequest & { auth?: { orgId?: string } };
    const orgId = req.auth?.orgId ?? 'anon';
    const routeId = req.routeOptions.url ?? req.url;

    // Hash query, params, and body to differentiate cache keys
    const payload = {
      query: req.query,
      params: req.params,
      body: req.body,
    };
    const payloadHash = bodyHash(payload);

    const key =
      options.key ??
      cacheKey([orgId, req.method, routeId, ...(options.tags ?? ['default']), payloadHash]);

    const cached = await cacheGet<{ data: T; headers?: Record<string, string> }>(key);
    if (cached.hit && cached.data) {
      return cached.data.data;
    }

    const inFlight = inFlightReads.get(key) as Promise<T> | undefined;
    if (inFlight) return inFlight;

    const promise = (async () => {
      const data = await handler();
      await cacheSet(key, { data }, options.ttlSeconds);
      return data;
    })();
    inFlightReads.set(key, promise);
    try {
      return await promise;
    } finally {
      inFlightReads.delete(key);
    }
  });

  server.addHook('onSend', async (req, reply, payload) => {
    // WHY: public routes (health, webhooks) do not always have auth. Protected
    // routes do, but hook code still reads defensively because it also runs for
    // unauthenticated responses.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const orgId = (req as any).auth?.orgId as string | undefined;
    if (!orgId) return payload;

    const method = req.method;
    const isMutation = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
    const isSuccess = reply.statusCode >= 200 && reply.statusCode < 300;

    if (isMutation && isSuccess) {
      // Invalidate all cache keys for this tenant orgId
      await cacheDel(`bidstack:cache:${orgId}:*`);
    }
    return payload;
  });
};

export const redisCachePlugin = fp(redisCachePluginImpl);
