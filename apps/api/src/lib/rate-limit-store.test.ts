import { createServer } from 'node:net';
import { Writable } from 'node:stream';

import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { errorHandlerPlugin } from '../plugins/error-handler.js';
import { startFrozenRedis, type FrozenRedis } from '../test-support/frozen-redis.js';

import { RATE_LIMIT_RETRY_AFTER_SECONDS, tagRateLimitStoreErrors } from './rate-limit-store.js';

// WHY: with POLO_DATA_MODE=real the limiter must not fail open, so a store
// error rejected the request — and the error handler masked it as a 500 after
// the 2 s command timeout. A store outage is a retryable condition: the client
// must get 503 + Retry-After inside the deadline, the request must still be
// refused (never let through unlimited), and the outage must be logged.
const previousUrl = process.env.REDIS_URL;
let fake: FrozenRedis | null = null;
let disconnect: (() => void) | null = null;

const storeReply = (count: number) => `*2\r\n:${count}\r\n:60000\r\n`;
const answering = (count: number) => ({ EVAL: storeReply(count), EVALSHA: storeReply(count) });

async function sharedClientAt(url: string, waitReady: boolean) {
  process.env.REDIS_URL = url;
  vi.resetModules();
  const { redis } = await import('../redis.js');
  disconnect = () => redis.disconnect();
  if (waitReady) {
    for (let i = 0; i < 50 && redis.status !== 'ready'; i++) await new Promise((r) => setTimeout(r, 20));
    expect(redis.status).toBe('ready');
  }
  return redis;
}

async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}

async function appWith(client: Awaited<ReturnType<typeof sharedClientAt>>, skipOnError: boolean) {
  const logs: Array<Record<string, unknown>> = [];
  const stream = new Writable({
    write(chunk: Buffer, _enc, done) {
      logs.push(JSON.parse(chunk.toString()) as Record<string, unknown>);
      done();
    },
  });
  const app = Fastify({ logger: { level: 'error', stream } });
  await app.register(errorHandlerPlugin);
  await app.register(rateLimit, { max: 10, timeWindow: 60_000, redis: tagRateLimitStoreErrors(client), skipOnError });
  app.get('/ping', async () => ({ ok: true }));
  await app.ready();
  return { app, logs };
}

describe('rate limiter when its Redis store fails and the limiter does not fail open', () => {
  afterEach(async () => {
    disconnect?.();
    disconnect = null;
    await fake?.close();
    fake = null;
    process.env.REDIS_URL = previousUrl;
    if (previousUrl === undefined) delete process.env.REDIS_URL;
  });

  it('refuses with 503 + Retry-After within the deadline when Redis froze, and logs it', async () => {
    fake = await startFrozenRedis();
    const { app, logs } = await appWith(await sharedClientAt(`redis://127.0.0.1:${fake.port}`, true), false);

    const started = Date.now();
    const res = await app.inject({ method: 'GET', url: '/ping' });
    const elapsed = Date.now() - started;

    expect(res.statusCode).toBe(503);
    expect(res.headers['retry-after']).toBe(String(RATE_LIMIT_RETRY_AFTER_SECONDS));
    expect(res.json()).toMatchObject({ statusCode: 503, error: 'Service Unavailable' });
    expect(elapsed).toBeLessThan(3_000);
    expect(fake.received).toContain('EVAL');
    expect(logs.some((l) => String(l.msg).startsWith('rate limit store unavailable'))).toBe(true);
    await app.close();
  });

  it('refuses with 503 + Retry-After at once when Redis is down', async () => {
    const client = await sharedClientAt(`redis://127.0.0.1:${await closedPort()}`, false);
    const { app } = await appWith(client, false);

    const started = Date.now();
    const res = await app.inject({ method: 'GET', url: '/ping' });

    expect(res.statusCode).toBe(503);
    expect(res.headers['retry-after']).toBe(String(RATE_LIMIT_RETRY_AFTER_SECONDS));
    expect(Date.now() - started).toBeLessThan(1_500);
    await app.close();
  });

  it('still serves and still enforces the limit when the store answers', async () => {
    fake = await startFrozenRedis(answering(1));
    const { app } = await appWith(await sharedClientAt(`redis://127.0.0.1:${fake.port}`, true), false);
    const ok = await app.inject({ method: 'GET', url: '/ping' });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers['x-ratelimit-remaining']).toBe('9');
    await app.close();
    disconnect?.();
    await fake.close();

    fake = await startFrozenRedis(answering(11));
    const limited = await appWith(await sharedClientAt(`redis://127.0.0.1:${fake.port}`, true), false);
    expect((await limited.app.inject({ method: 'GET', url: '/ping' })).statusCode).toBe(429);
    await limited.app.close();
  });

  it('serves again by itself after an outage longer than ~3 s, with no readiness probe', async () => {
    // WHY: the shared client gave up after 5 reconnect attempts (~3 s), and
    // the rate-limit store never calls ensureRedisReady(), so every request
    // stayed 503 after Redis came back until /readyz reconnected the client.
    // This app has no /readyz and nothing here reconnects the client.
    fake = await startFrozenRedis(answering(1));
    const port = fake.port;
    const client = await sharedClientAt(`redis://127.0.0.1:${port}`, true);
    const { redisLog } = await import('../redis.js');
    const warn = vi.spyOn(redisLog, 'warn').mockImplementation(() => undefined);
    let reconnects = 0;
    client.on('reconnecting', () => reconnects++);
    const { app } = await appWith(client, false);
    const ping = () => app.inject({ method: 'GET', url: '/ping' });
    expect((await ping()).statusCode).toBe(200);

    await fake.close();
    fake = null;
    expect((await ping()).statusCode).toBe(503);
    await new Promise((r) => setTimeout(r, 4_000));
    fake = await startFrozenRedis(answering(1), port);

    let status = 0;
    for (const deadline = Date.now() + 6_000; status !== 200 && Date.now() < deadline; ) {
      await new Promise((r) => setTimeout(r, 250));
      status = (await ping()).statusCode;
    }
    expect(status).toBe(200);
    expect(client.status).toBe('ready');
    // WHY: the outage itself was silent in the logs (the 'error' handler
    // swallows it), but one warning per reconnect attempt would flood them.
    expect(reconnects).toBeGreaterThan(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[1]).toMatch(/reconnecting/);
    warn.mockRestore();
    await app.close();
  }, 20_000);

  it('keeps failing open where skipOnError allows it (non-real modes)', async () => {
    fake = await startFrozenRedis();
    const { app } = await appWith(await sharedClientAt(`redis://127.0.0.1:${fake.port}`, true), true);
    expect((await app.inject({ method: 'GET', url: '/ping' })).statusCode).toBe(200);
    await app.close();
  });
});
