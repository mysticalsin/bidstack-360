import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildServer } from '../../server.js';

const URL_BASE = '/api/v1/integrations/microsoft/webhook';

let server: FastifyInstance;
beforeAll(async () => {
  server = await buildServer();
  await server.ready();
});
afterAll(async () => {
  await server?.close();
});

// Regression: Graph validates notificationUrl with a POST (not a GET) that
// carries ?validationToken and an empty text/plain body. The POST route used to
// run NotificationBody validation first and answer 4xx, so Graph refused to
// create every subscription.
describe('Microsoft Graph webhook validation handshake', () => {
  it('echoes the decoded token for the POST handshake Graph actually sends', async () => {
    const res = await server.inject({
      method: 'POST',
      url: `${URL_BASE}?validationToken=abc%20def%3Dxyz`,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
      payload: '',
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/plain/);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.body).toBe('abc def=xyz');
  });

  it('still answers the GET form', async () => {
    const res = await server.inject({ method: 'GET', url: `${URL_BASE}?validationToken=tok` });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('tok');
  });

  it('refuses to reflect oversized tokens', async () => {
    const res = await server.inject({
      method: 'POST',
      url: `${URL_BASE}?validationToken=${'a'.repeat(5000)}`,
      headers: { 'content-type': 'text/plain' },
      payload: '',
    });
    expect(res.statusCode).toBe(400);
  });

  it('a POST without a token still requires a valid notification body', async () => {
    const res = await server.inject({
      method: 'POST',
      url: URL_BASE,
      headers: { 'content-type': 'application/json' },
      payload: { nope: true },
    });
    expect(res.statusCode).toBe(400);
  });
});
