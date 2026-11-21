/**
 * Readiness must degrade, not hang. A Postgres or Redis that accepts the
 * connection but never answers (network partition, pool exhausted, failover)
 * has to turn into a fast 503 so the orchestrator pulls the replica, instead
 * of a probe that pins a socket until REQUEST_TIMEOUT_MS.
 */
import Fastify from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  db: 'ok' as 'ok' | 'hang' | 'down',
  redis: 'ok' as 'ok' | 'hang' | 'down' | 'slow',
}));

const never = () => new Promise<never>(() => undefined);

vi.mock('@bidstack/db', () => ({
  prisma: {
    $queryRaw: vi.fn(() => {
      if (state.db === 'hang') return never();
      if (state.db === 'down') return Promise.reject(new Error('ECONNREFUSED'));
      return Promise.resolve([{ ok: 1 }]);
    }),
  },
}));

vi.mock('../redis.js', () => ({
  pingRedis: vi.fn(() => {
    if (state.redis === 'hang') return never();
    if (state.redis === 'slow') return new Promise((resolve) => setTimeout(() => resolve(true), 250));
    return Promise.resolve(state.redis === 'ok');
  }),
}));

const { healthRoute } = await import('./health.js');

async function app() {
  const server = Fastify({ logger: false }).withTypeProvider<ZodTypeProvider>();
  server.setValidatorCompiler(validatorCompiler);
  server.setSerializerCompiler(serializerCompiler);
  await server.register(healthRoute);
  return server;
}

afterEach(() => {
  state.db = 'ok';
  state.redis = 'ok';
  delete process.env.HEALTH_PROBE_TIMEOUT_MS;
});

describe('health probes under dependency outages', () => {
  it('answers 200 when Postgres and Redis are up', async () => {
    const server = await app();
    const res = await server.inject({ method: 'GET', url: '/readyz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      ok: true,
      db: true,
      redis: true,
      dependencies: {
        db: { status: 'connected' },
        redis: { status: 'connected' },
      },
    });
    expect(res.json().dependencies.redis.latencyMs).toEqual(expect.any(Number));
    await server.close();
  });

  it('answers 503 with db=false when Postgres refuses connections', async () => {
    state.db = 'down';
    const server = await app();
    const res = await server.inject({ method: 'GET', url: '/readyz' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ ok: false, db: false, redis: true });
    await server.close();
  });

  it('answers 503 with redis=false when Redis is down', async () => {
    state.redis = 'down';
    const server = await app();
    const res = await server.inject({ method: 'GET', url: '/readyz' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({
      ok: false,
      db: true,
      redis: false,
      dependencies: {
        db: { status: 'connected' },
        redis: { status: 'unavailable' },
      },
    });
    expect(res.json().dependencies.redis.latencyMs).toEqual(expect.any(Number));
    await server.close();
  });

  it('answers 503 quickly when Postgres hangs instead of waiting on the query', async () => {
    process.env.HEALTH_PROBE_TIMEOUT_MS = '200';
    state.db = 'hang';
    const server = await app();
    const started = Date.now();
    const res = await server.inject({ method: 'GET', url: '/readyz' });
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ ok: false, db: false });
    await server.close();
  });

  it('answers 503 quickly when Redis hangs', async () => {
    process.env.HEALTH_PROBE_TIMEOUT_MS = '200';
    state.redis = 'hang';
    const server = await app();
    const started = Date.now();
    const res = await server.inject({ method: 'GET', url: '/readyz' });
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ ok: false, redis: false });
    await server.close();
  });

  it('keeps /livez at 200 while dependencies hang', async () => {
    state.db = 'hang';
    state.redis = 'hang';
    const server = await app();
    const res = await server.inject({ method: 'GET', url: '/livez' });
    expect(res.statusCode).toBe(200);
    await server.close();
  });

  it('keeps /healthz at 200 while Redis is down', async () => {
    state.redis = 'down';
    const server = await app();
    const started = Date.now();
    const res = await server.inject({ method: 'GET', url: '/healthz' });
    expect(Date.now() - started).toBeLessThan(500);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true });
    await server.close();
  });

  it('reports a slow Redis ping as degraded and still ready', async () => {
    process.env.HEALTH_PROBE_TIMEOUT_MS = '400';
    state.redis = 'slow';
    const server = await app();
    const res = await server.inject({ method: 'GET', url: '/readyz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      ok: true,
      redis: true,
      dependencies: { redis: { status: 'degraded' } },
    });
    expect(res.json().dependencies.redis.latencyMs).toBeGreaterThanOrEqual(200);
    await server.close();
  });
});
