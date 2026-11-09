import { createHmac } from 'node:crypto';

import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { zoomCallWebhookRoutes } from './calls-webhooks.js';

// WHY: Zoom signs the exact bytes it sends. The route read `req.rawBody`,
// which nothing set, and fell back to JSON.stringify of the parsed body, so a
// genuine event whose bytes differ from Node's re-serialisation (spacing,
// \u escapes) was rejected with 403. The signature must be checked against
// the received bytes, and a body altered after signing must still be refused.
const SECRET = 'synthetic-zoom-secret-for-tests';
const previousSecret = process.env.ZOOM_SECRET_TOKEN;

// Valid JSON whose bytes JSON.stringify would not reproduce.
const RAW = '{"event": "meeting.started", "payload": {"object": {"id": "1", "topic": "Caf\\u00e9 review"}}}';

function sign(body: string, timestamp: string) {
  return `v0=${createHmac('sha256', SECRET).update(`v0:${timestamp}:${body}`).digest('hex')}`;
}

async function buildApp() {
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(zoomCallWebhookRoutes, { prefix: '/api/v1/integrations' });
  await app.ready();
  return app;
}

function post(app: Awaited<ReturnType<typeof buildApp>>, body: string, headers: Record<string, string>) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/integrations/zoom/webhook',
    headers: { 'content-type': 'application/json', ...headers },
    payload: body,
  });
}

describe('Zoom webhook signature', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    process.env.ZOOM_SECRET_TOKEN = SECRET;
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
    if (previousSecret === undefined) delete process.env.ZOOM_SECRET_TOKEN;
    else process.env.ZOOM_SECRET_TOKEN = previousSecret;
  });

  it('accepts a genuine event whose bytes differ from the re-serialised body', async () => {
    expect(JSON.stringify(JSON.parse(RAW))).not.toBe(RAW);
    const ts = String(Date.now());

    const res = await post(app, RAW, { 'x-zm-signature': sign(RAW, ts), 'x-zm-request-timestamp': ts });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it('refuses a body altered after signing', async () => {
    const ts = String(Date.now());
    const tampered = RAW.replace('review', 'reviev');

    const res = await post(app, tampered, { 'x-zm-signature': sign(RAW, ts), 'x-zm-request-timestamp': ts });

    expect(res.statusCode).toBe(403);
  });

  it('refuses an event without a signature', async () => {
    const res = await post(app, RAW, { 'x-zm-request-timestamp': String(Date.now()) });
    expect(res.statusCode).toBe(403);
  });
});
