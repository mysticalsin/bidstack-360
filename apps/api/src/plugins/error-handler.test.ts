// WHY: a route that throws httpErrors.serviceUnavailable is telling the caller
// the feature is not set up. Collapsing that to a generic 500 hides a
// condition the operator can fix, and a real crash must not leak its text.

import sensible from '@fastify/sensible';
import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { errorHandlerPlugin } from './error-handler.js';

const HUBSPOT_NOT_CONFIGURED =
  'HubSpot OAuth not configured — set HUBSPOT_CLIENT_ID and HUBSPOT_REDIRECT_URI';
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
