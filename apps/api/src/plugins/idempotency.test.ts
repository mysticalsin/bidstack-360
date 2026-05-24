import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import sensible from '@fastify/sensible';

import { idempotencyPlugin } from './idempotency.js';
import type { AuthContext } from './auth.js';

const TEST_AUTH: AuthContext = {
  orgId: 'test-org',
  userId: 'test-user',
  scopes: ['read', 'write'],
  role: 'admin',
};

describe('idempotencyPlugin', () => {
  it('ignores idempotency key on safe methods (GET)', async () => {
    const server = Fastify({ logger: false });
    await server.register(sensible);
    await server.register(idempotencyPlugin);
    server.get('/test', async () => ({ ok: true }));

    const res = await server.inject({
      method: 'GET',
      url: '/test',
      headers: { 'Idempotency-Key': 'safe-key-123' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-idempotency-key']).toBeUndefined();
  });

  it('caches POST responses and replays duplicates', async () => {
    const server = Fastify({ logger: false });
    await server.register(sensible);
    server.decorateRequest('auth', undefined as unknown as AuthContext);
    server.addHook('onRequest', async (req) => {
      req.auth = TEST_AUTH;
    });
    await server.register(idempotencyPlugin);
    let counter = 0;
    server.post('/test', async () => ({ counter: ++counter }));

    const key = 'post-key-123';
    const first = await server.inject({
      method: 'POST',
      url: '/test',
      headers: { 'Idempotency-Key': key },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({ counter: 1 });
    expect(first.headers['x-idempotency-key']).toBe(key);

    const second = await server.inject({
      method: 'POST',
      url: '/test',
      headers: { 'Idempotency-Key': key },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual({ counter: 1 });
    expect(second.headers['x-idempotency-replay']).toBe('true');
  });

  it('rejects reuse of a key with a different request fingerprint', async () => {
    const server = Fastify({ logger: false });
    await server.register(sensible);
    server.decorateRequest('auth', undefined as unknown as AuthContext);
    server.addHook('onRequest', async (req) => {
      req.auth = TEST_AUTH;
    });
    await server.register(idempotencyPlugin);
    server.post('/test', async (req) => ({ body: req.body }));

    const key = 'fingerprint-key-123';
    const first = await server.inject({
      method: 'POST',
      url: '/test',
      headers: { 'Idempotency-Key': key },
      payload: { name: 'first' },
    });
    expect(first.statusCode).toBe(200);

    const second = await server.inject({
      method: 'POST',
      url: '/test',
      headers: { 'Idempotency-Key': key },
      payload: { name: 'second' },
    });
    expect(second.statusCode).toBe(409);
  });

  it('treats equivalent JSON payloads as the same fingerprint regardless of key order', async () => {
    const server = Fastify({ logger: false });
    await server.register(sensible);
    server.decorateRequest('auth', undefined as unknown as AuthContext);
    server.addHook('onRequest', async (req) => {
      req.auth = TEST_AUTH;
    });
    await server.register(idempotencyPlugin);
    let counter = 0;
    server.post('/test', async () => ({ counter: ++counter }));

    const key = 'stable-body-key-123';
    const first = await server.inject({
      method: 'POST',
      url: '/test',
      headers: { 'Idempotency-Key': key },
      payload: { a: 1, b: 2 },
    });
    expect(first.statusCode).toBe(200);

    const second = await server.inject({
      method: 'POST',
      url: '/test',
      headers: { 'Idempotency-Key': key },
      payload: { b: 2, a: 1 },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual({ counter: 1 });
    expect(second.headers['x-idempotency-replay']).toBe('true');
  });

  it('rejects a concurrent in-flight reuse with a different request fingerprint', async () => {
    const server = Fastify({ logger: false });
    await server.register(sensible);
    server.decorateRequest('auth', undefined as unknown as AuthContext);
    server.addHook('onRequest', async (req) => {
      req.auth = TEST_AUTH;
    });
    await server.register(idempotencyPlugin);

    let markStarted!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });

    server.post('/slow', async () => {
      markStarted();
      await hold;
      return { ok: true };
    });

    const key = 'inflight-key-123';
    const first = server.inject({
      method: 'POST',
      url: '/slow',
      headers: { 'Idempotency-Key': key },
      payload: { name: 'first' },
    });
    await started;

    const second = await server.inject({
      method: 'POST',
      url: '/slow',
      headers: { 'Idempotency-Key': key },
      payload: { name: 'second' },
    });
    expect(second.statusCode).toBe(409);

    release();
    expect((await first).statusCode).toBe(200);
  });

  it('caches PATCH and DELETE responses', async () => {
    const server = Fastify({ logger: false });
    await server.register(sensible);
    server.decorateRequest('auth', undefined as unknown as AuthContext);
    server.addHook('onRequest', async (req) => {
      req.auth = TEST_AUTH;
    });
    await server.register(idempotencyPlugin);
    server.patch('/test', async () => ({ patched: true }));
    server.delete('/test', async () => ({ deleted: true }));

    const patchKey = 'patch-key-456';
    const firstPatch = await server.inject({
      method: 'PATCH',
      url: '/test',
      headers: { 'Idempotency-Key': patchKey },
    });
    expect(firstPatch.statusCode).toBe(200);

    const secondPatch = await server.inject({
      method: 'PATCH',
      url: '/test',
      headers: { 'Idempotency-Key': patchKey },
    });
    expect(secondPatch.statusCode).toBe(200);
    expect(secondPatch.headers['x-idempotency-replay']).toBe('true');

    const delKey = 'del-key-789';
    const firstDel = await server.inject({
      method: 'DELETE',
      url: '/test',
      headers: { 'Idempotency-Key': delKey },
    });
    expect(firstDel.statusCode).toBe(200);

    const secondDel = await server.inject({
      method: 'DELETE',
      url: '/test',
      headers: { 'Idempotency-Key': delKey },
    });
    expect(secondDel.statusCode).toBe(200);
    expect(secondDel.headers['x-idempotency-replay']).toBe('true');
  });

  it('rejects invalid idempotency key lengths', async () => {
    const server = Fastify({ logger: false });
    await server.register(sensible);
    await server.register(idempotencyPlugin);
    server.post('/test', async () => ({ ok: true }));

    const short = await server.inject({
      method: 'POST',
      url: '/test',
      headers: { 'Idempotency-Key': 'short' },
    });
    expect(short.statusCode).toBe(400);

    const long = await server.inject({
      method: 'POST',
      url: '/test',
      headers: { 'Idempotency-Key': 'a'.repeat(256) },
    });
    expect(long.statusCode).toBe(400);
  });

  it('does not cache when idempotency key is absent', async () => {
    const server = Fastify({ logger: false });
    await server.register(sensible);
    await server.register(idempotencyPlugin);
    let counter = 0;
    server.post('/test', async () => ({ counter: ++counter }));

    const first = await server.inject({ method: 'POST', url: '/test' });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({ counter: 1 });

    const second = await server.inject({ method: 'POST', url: '/test' });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual({ counter: 2 });
  });
});
