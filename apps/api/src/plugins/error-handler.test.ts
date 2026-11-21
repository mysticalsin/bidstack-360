// WHY: a route that throws httpErrors.serviceUnavailable is telling the caller
// the feature is not set up. Collapsing that to a generic 500 hides a
// condition the operator can fix, and a real crash must not leak its text.

import sensible from '@fastify/sensible';
import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { IntegrationTokenKeyMissingError } from '@bidstack/shared/server-crypto';

import { errorHandlerPlugin } from './error-handler.js';

const HUBSPOT_NOT_CONFIGURED = 'HubSpot is not configured';
const SECRET = 'postgres://bidstack:secret-token@db.internal:5432/bidstack';

async function app() {
  const server = Fastify({ logger: false });
  await server.register(sensible);
  await server.register(errorHandlerPlugin);
  server.get('/unavailable', async () => {
    throw server.httpErrors.serviceUnavailable(HUBSPOT_NOT_CONFIGURED);
  });
  server.get('/boom', async () => {
    throw new Error(SECRET);
  });
  return server;
}

describe('error handler status contract', () => {
  let server: Awaited<ReturnType<typeof app>>;

  afterEach(async () => {
    if (server) await server.close();
  });

  it('keeps a deliberate 503 and its safe message', async () => {
    server = await app();
    const res = await server.inject({ method: 'GET', url: '/unavailable' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({
      statusCode: 503,
      error: 'Service Unavailable',
      message: HUBSPOT_NOT_CONFIGURED,
    });
  });

  it('does not pass through a plain Error that only forges a 503 name', async () => {
    server = Fastify({ logger: false });
    await server.register(sensible);
    await server.register(errorHandlerPlugin);
    const secret = 'postgres://bidstack:secret-token@db.internal/bidstack';
    server.get('/forged', async () => {
      const err = new Error(secret);
      err.name = 'ServiceUnavailableError';
      (err as { statusCode?: number }).statusCode = 503;
      throw err;
    });
    server.get('/forged-key', async () => {
      const err = new Error(secret);
      err.name = 'IntegrationTokenKeyMissingError';
      (err as { statusCode?: number }).statusCode = 503;
      throw err;
    });
    const res = await server.inject({ method: 'GET', url: '/forged' });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({
      statusCode: 500,
      error: 'Internal Server Error',
      message: 'Something went wrong',
    });
    expect(res.body).not.toContain('secret-token');
    const forgedKey = await server.inject({ method: 'GET', url: '/forged-key' });
    expect(forgedKey.statusCode).toBe(500);
    expect(forgedKey.json()).toEqual({
      statusCode: 500,
      error: 'Internal Server Error',
      message: 'Something went wrong',
    });
    expect(forgedKey.body).not.toContain('secret-token');
  });

  it('does not pass through a ServiceUnavailable built on another server', async () => {
    const other = Fastify({ logger: false });
    await other.register(sensible);
    const foreign = other.httpErrors.serviceUnavailable(SECRET);
    server = Fastify({ logger: false });
    await server.register(sensible);
    await server.register(errorHandlerPlugin);
    server.get('/foreign', async () => {
      throw foreign;
    });
    const res = await server.inject({ method: 'GET', url: '/foreign' });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({
      statusCode: 500,
      error: 'Internal Server Error',
      message: 'Something went wrong',
    });
    expect(res.body).not.toContain('secret-token');
    await other.close();
  });

  it('keeps the token-key 503 when the prototype is no longer the class', async () => {
    server = Fastify({ logger: false });
    await server.register(sensible);
    await server.register(errorHandlerPlugin);
    server.get('/key', async () => {
      const err = new IntegrationTokenKeyMissingError();
      Object.setPrototypeOf(err, Error.prototype);
      err.name = 'mangled';
      throw err;
    });
    const res = await server.inject({ method: 'GET', url: '/key' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({
      statusCode: 503,
      error: 'Service Unavailable',
      message: 'Integration token encryption is not configured',
    });
  });

  it('does not copy a sentinel buried in cause into the 500 body or the log', async () => {
    const lines: string[] = [];
    server = Fastify({
      logger: {
        level: 'error',
        stream: {
          write(chunk: string) {
            lines.push(chunk);
          },
        },
      },
    });
    await server.register(sensible);
    await server.register(errorHandlerPlugin);
    server.get('/cause', async () => {
      const err = new Error('Something failed');
      err.cause = new Error('provider-body-SENTINEL-upstream-text');
      throw err;
    });
    const res = await server.inject({ method: 'GET', url: '/cause' });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({
      statusCode: 500,
      error: 'Internal Server Error',
      message: 'Something went wrong',
    });
    expect(res.body).not.toContain('provider-body-SENTINEL-upstream-text');
    expect(lines.join('\n')).not.toContain('provider-body-SENTINEL-upstream-text');
  });

  it('hides unexpected failures behind a generic 500', async () => {
    server = await app();
    const res = await server.inject({ method: 'GET', url: '/boom' });
    expect(res.statusCode).toBe(500);
    const body = res.json<{ statusCode: number; error: string; message: string }>();
    expect(body).toEqual({
      statusCode: 500,
      error: 'Internal Server Error',
      message: 'Something went wrong',
    });
    expect(res.body).not.toContain('secret-token');
    expect(res.body).not.toContain('postgres://');
    expect(res.body).not.toContain('db.internal');
  });
});
