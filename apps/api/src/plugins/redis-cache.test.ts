import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { redisCachePlugin } from './redis-cache.js';
import { cacheDel } from '../lib/redis-cache.js';

describe('redisCachePlugin', () => {
  beforeEach(async () => {
    await cacheDel('bidstack:cache:*');
  });

  afterAll(async () => {
    // Clean up test keys
    await cacheDel('bidstack:cache:*');
  });

  it('decorates FastifyRequest and caches the route response', async () => {
    const server = Fastify({ logger: false });
    await server.register(redisCachePlugin, { enabledInTest: true });

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
    await server.register(redisCachePlugin, { enabledInTest: true });

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
    await server.register(redisCachePlugin, { enabledInTest: true });

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

  it('coalesces concurrent cache misses for the same tenant key', async () => {
    const server = Fastify({ logger: false });
    await server.register(redisCachePlugin, { enabledInTest: true });

    let handlerCalls = 0;

    server.get('/test-inflight', async (req) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test stub: auth injected by plugin in production; bare FastifyRequest has no auth property
      (req as any).auth = { orgId: 'inflight-org' };
      return req.cache(
        async () => {
          handlerCalls++;
          await new Promise((resolve) => setTimeout(resolve, 25));
          return { count: handlerCalls };
        },
        { ttlSeconds: 10, tags: ['inflight-tag'] },
      );
    });

    const [res1, res2, res3] = await Promise.all([
      server.inject({ method: 'GET', url: '/test-inflight' }),
      server.inject({ method: 'GET', url: '/test-inflight' }),
      server.inject({ method: 'GET', url: '/test-inflight' }),
    ]);

    expect(res1.json()).toEqual({ count: 1 });
    expect(res2.json()).toEqual({ count: 1 });
    expect(res3.json()).toEqual({ count: 1 });
    expect(handlerCalls).toBe(1);
  });

  it('invalidates cache on successful mutation requests', async () => {
    const server = Fastify({ logger: false });
    await server.register(redisCachePlugin, { enabledInTest: true });
    const orgId = `mutation-org-${Date.now()}`;
    server.addHook('preHandler', async (req) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test stub: production auth is assigned before route handlers run
      (req as any).auth = { orgId };
    });

    let getCalls = 0;

    server.get('/test-read', async (req) => {
      return req.cache(
        async () => {
          getCalls++;
          return { count: getCalls };
        },
        { ttlSeconds: 10, tags: ['mutation-tag'] },
      );
    });

    server.post('/test-mutate', async () => {
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

  it('does not store a read that was in flight when the org cache was invalidated', async () => {
    const server = Fastify({ logger: false });
    await server.register(redisCachePlugin, { enabledInTest: true });
    const orgId = `fill-race-${Date.now()}`;
    server.addHook('preHandler', async (req) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test stub: production auth is assigned before route handlers run
      (req as any).auth = { orgId };
    });

    let calls = 0;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let markEntered: () => void = () => undefined;
    const entered = new Promise<void>((resolve) => {
      markEntered = resolve;
    });

    server.get('/slow-read', async (req) => {
      return req.cache(
        async () => {
          calls += 1;
          const value = calls;
          markEntered();
          await gate;
          return { value };
        },
        { ttlSeconds: 30, tags: ['fill-race'] },
      );
    });

    server.post('/mutate', async () => ({ mutated: true }));

    const slow = server.inject({ method: 'GET', url: '/slow-read' });
    await entered;
    const mutated = await server.inject({ method: 'POST', url: '/mutate' });
    expect(mutated.statusCode).toBe(200);
    release();
    const first = await slow;
    expect(first.json()).toEqual({ value: 1 });

    const again = await server.inject({ method: 'GET', url: '/slow-read' });
    expect(again.json()).toEqual({ value: 2 });
    expect(calls).toBe(2);

    await server.close();
  });
});
