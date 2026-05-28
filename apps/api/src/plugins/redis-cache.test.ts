import { describe, it, expect, afterAll } from 'vitest';
import Fastify from 'fastify';
import { redisCachePlugin } from './redis-cache.js';
import { cacheDel } from '../lib/redis-cache.js';

describe('redisCachePlugin', () => {
  afterAll(async () => {
    // Clean up test keys
    await cacheDel('bidstack:cache:*');
  });

  it('decorates FastifyRequest and caches the route response', async () => {
    const server = Fastify({ logger: false });
    await server.register(redisCachePlugin);

    let handlerCalls = 0;

    server.get('/test-cached', async (req) => {
      // Mock auth orgId
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test stub: auth injected by plugin in production; bare FastifyRequest has no auth property
      (req as any).auth = { orgId: 'test-org-1' };
      return req.cache(
        async () => {
          handlerCalls++;
          return { value: 'hello' };
        },
        { ttlSeconds: 10, tags: ['test-tag'] },
      );
    });

    const res1 = await server.inject({ method: 'GET', url: '/test-cached' });
    expect(res1.statusCode).toBe(200);
    expect(res1.json()).toEqual({ value: 'hello' });
    expect(handlerCalls).toBe(1);

    // Second call should serve from cache
    const res2 = await server.inject({ method: 'GET', url: '/test-cached' });
    expect(res2.statusCode).toBe(200);
    expect(res2.json()).toEqual({ value: 'hello' });
    expect(handlerCalls).toBe(1); // Cached, handler shouldn't be called again
  });

  it('scopes cache by tenant orgId (tenant isolation)', async () => {
    const server = Fastify({ logger: false });
    await server.register(redisCachePlugin);

    let handlerCalls = 0;

    server.get('/test-tenant', async (req) => {
      const orgId = req.query as Record<string, string>;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test stub: auth injected by plugin in production; bare FastifyRequest has no auth property
      (req as any).auth = { orgId: orgId.org };
      return req.cache(
        async () => {
          handlerCalls++;
          return { org: orgId.org };
        },
        { ttlSeconds: 10, tags: ['tenant-tag'] },
      );
    });

    const resOrg1 = await server.inject({ method: 'GET', url: '/test-tenant?org=tenant1' });
    expect(resOrg1.json()).toEqual({ org: 'tenant1' });
    expect(handlerCalls).toBe(1);

    const resOrg2 = await server.inject({ method: 'GET', url: '/test-tenant?org=tenant2' });
    expect(resOrg2.json()).toEqual({ org: 'tenant2' });
    expect(handlerCalls).toBe(2); // Isolated, must execute for different orgId
  });

  it('differentiates cache keys by query parameters', async () => {
    const server = Fastify({ logger: false });
    await server.register(redisCachePlugin);

    let handlerCalls = 0;

    server.get('/test-query', async (req) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test stub: auth injected by plugin in production; bare FastifyRequest has no auth property
      (req as any).auth = { orgId: 'test-org' };
      return req.cache(
        async () => {
          handlerCalls++;
          return { query: (req.query as Record<string, string>).q };
        },
        { ttlSeconds: 10, tags: ['query-tag'] },
      );
    });

    const resQ1 = await server.inject({ method: 'GET', url: '/test-query?q=foo' });
    expect(resQ1.json()).toEqual({ query: 'foo' });
    expect(handlerCalls).toBe(1);

    const resQ2 = await server.inject({ method: 'GET', url: '/test-query?q=bar' });
    expect(resQ2.json()).toEqual({ query: 'bar' });
    expect(handlerCalls).toBe(2); // Differentiated by query hash
  });

  it('invalidates cache on successful mutation requests', async () => {
    const server = Fastify({ logger: false });
    await server.register(redisCachePlugin);

    let getCalls = 0;

    server.get('/test-read', async (req) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test stub: auth injected by plugin in production; bare FastifyRequest has no auth property
      (req as any).auth = { orgId: 'mutation-org' };
      return req.cache(
        async () => {
          getCalls++;
          return { count: getCalls };
        },
        { ttlSeconds: 10, tags: ['mutation-tag'] },
      );
    });

    server.post('/test-mutate', async (req) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test stub: auth injected by plugin in production; bare FastifyRequest has no auth property
      (req as any).auth = { orgId: 'mutation-org' };
      return { mutated: true };
    });

    // 1. Initial read
    const res1 = await server.inject({ method: 'GET', url: '/test-read' });
    expect(res1.json()).toEqual({ count: 1 });

    // 2. Cached read
    const res2 = await server.inject({ method: 'GET', url: '/test-read' });
    expect(res2.json()).toEqual({ count: 1 });

    // 3. Mutate (POST) -> triggers invalidation
    const resMutate = await server.inject({ method: 'POST', url: '/test-mutate' });
    expect(resMutate.statusCode).toBe(200);

    // 4. Subsequent read -> cache is cleared, handler runs again
    const res3 = await server.inject({ method: 'GET', url: '/test-read' });
    expect(res3.json()).toEqual({ count: 2 });
  });
});
