// WHY: a 503 this handler now returns is visible to whoever can call the
// route. A public route must not name the missing env var. The name stays
// in the server log.

import sensible from '@fastify/sensible';
import Fastify from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { afterEach, describe, expect, it } from 'vitest';

import { opsSentrySmokeRoutes } from '../routes/ops-sentry-smoke.js';
import { webhooksClerkRoutes } from '../routes/webhooks-clerk.js';
import { webhooksRoutes } from '../routes/webhooks.js';
import { authPlugin } from './auth.js';
import {
  CF_ACCESS_EMAIL_HEADER,
  verifyCfAccessAuth,
} from './cf-access-auth.js';
import { errorHandlerPlugin } from './error-handler.js';

const GENERIC = 'integration not configured';

async function app() {
  const lines: string[] = [];
  const server = Fastify({
    logger: {
      level: 'warn',
      stream: {
        write(chunk: string) {
          lines.push(chunk);
        },
      },
    },
  }).withTypeProvider<ZodTypeProvider>();
  server.setValidatorCompiler(validatorCompiler);
  server.setSerializerCompiler(serializerCompiler);
  await server.register(sensible);
  await server.register(errorHandlerPlugin);
  return { server, lines };
}

describe('config 503 audience', () => {
  const previous = {
    clerk: process.env.CLERK_WEBHOOK_SECRET,
    dust: process.env.DUST_WEBHOOK_SECRET,
    smoke: process.env.SENTRY_SMOKE_ENABLED,
    dsn: process.env.SENTRY_DSN,
    release: process.env.SENTRY_RELEASE,
    smokeToken: process.env.SENTRY_SMOKE_TOKEN,
    allow: process.env.POLO_ALLOWED_USERS,
    loopback: process.env.CF_ACCESS_TRUST_LOOPBACK_EMAIL,
    nodeEnv: process.env.NODE_ENV,
    clerkKey: process.env.CLERK_SECRET_KEY,
    publicBase: process.env.PUBLIC_BASE_URL,
    demo: process.env.DEMO_MODE,
    cfAccess: process.env.CF_ACCESS_AUTH,
  };
  let close: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (close) await close();
    close = undefined;
    restore('CLERK_WEBHOOK_SECRET', previous.clerk);
    restore('DUST_WEBHOOK_SECRET', previous.dust);
    restore('SENTRY_SMOKE_ENABLED', previous.smoke);
    restore('SENTRY_DSN', previous.dsn);
    restore('SENTRY_RELEASE', previous.release);
    restore('SENTRY_SMOKE_TOKEN', previous.smokeToken);
    restore('POLO_ALLOWED_USERS', previous.allow);
    restore('CF_ACCESS_TRUST_LOOPBACK_EMAIL', previous.loopback);
    restore('NODE_ENV', previous.nodeEnv);
    restore('CLERK_SECRET_KEY', previous.clerkKey);
    restore('PUBLIC_BASE_URL', previous.publicBase);
    restore('DEMO_MODE', previous.demo);
    restore('CF_ACCESS_AUTH', previous.cfAccess);
  });

  it('does not name CLERK_WEBHOOK_SECRET on the public clerk webhook', async () => {
    delete process.env.CLERK_WEBHOOK_SECRET;
    const { server, lines } = await app();
    close = () => server.close();
    await server.register(webhooksClerkRoutes);
    const res = await server.inject({
      method: 'POST',
      url: '/clerk',
      payload: { type: 'organization.created', data: { id: 'org_x' } },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ statusCode: 503, message: GENERIC });
    expect(res.body).not.toContain('CLERK_WEBHOOK_SECRET');
    expect(lines.join('\n')).toContain('CLERK_WEBHOOK_SECRET');
  });

  it('does not name DUST_WEBHOOK_SECRET on the public dust webhook', async () => {
    delete process.env.DUST_WEBHOOK_SECRET;
    const { server, lines } = await app();
    close = () => server.close();
    await server.register(webhooksRoutes);
    const res = await server.inject({
      method: 'POST',
      url: '/dust',
      payload: {},
    });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ statusCode: 503, message: GENERIC });
    expect(res.body).not.toContain('DUST_WEBHOOK_SECRET');
    expect(lines.join('\n')).toContain('DUST_WEBHOOK_SECRET');
  });

  it('does not name SENTRY_DSN on the public sentry smoke route', async () => {
    process.env.SENTRY_SMOKE_ENABLED = 'true';
    delete process.env.SENTRY_DSN;
    const { server, lines } = await app();
    close = () => server.close();
    await server.register(opsSentrySmokeRoutes);
    const res = await server.inject({
      method: 'POST',
      url: '/ops/sentry-smoke/api',
      payload: {},
    });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ statusCode: 503, message: GENERIC });
    expect(res.body).not.toContain('SENTRY_DSN');
    expect(lines.join('\n')).toContain('SENTRY_DSN');
  });

  it('does not name SENTRY_RELEASE on the public sentry smoke route', async () => {
    process.env.SENTRY_SMOKE_ENABLED = 'true';
    process.env.SENTRY_DSN = 'https://public@sentry.example/1';
    delete process.env.SENTRY_RELEASE;
    const { server, lines } = await app();
    close = () => server.close();
    await server.register(opsSentrySmokeRoutes);
    const res = await server.inject({
      method: 'POST',
      url: '/ops/sentry-smoke/api',
      payload: {},
    });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ statusCode: 503, message: GENERIC });
    expect(res.body).not.toContain('SENTRY_RELEASE');
    expect(lines.join('\n')).toContain('SENTRY_RELEASE');
  });

  it('does not name SENTRY_SMOKE_TOKEN on the public sentry smoke route', async () => {
    process.env.SENTRY_SMOKE_ENABLED = 'true';
    process.env.SENTRY_DSN = 'https://public@sentry.example/1';
    process.env.SENTRY_RELEASE = 'rel';
    process.env.SENTRY_SMOKE_TOKEN = 'short';
    const { server, lines } = await app();
    close = () => server.close();
    await server.register(opsSentrySmokeRoutes);
    const res = await server.inject({
      method: 'POST',
      url: '/ops/sentry-smoke/api',
      payload: {},
    });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ statusCode: 503, message: GENERIC });
    expect(res.body).not.toContain('SENTRY_SMOKE_TOKEN');
    expect(lines.join('\n')).toContain('SENTRY_SMOKE_TOKEN');
  });

  it('does not name POLO_ALLOWED_USERS when Access identity is misconfigured', async () => {
    process.env.POLO_ALLOWED_USERS = 'not-a-valid-allowlist';
    process.env.CF_ACCESS_TRUST_LOOPBACK_EMAIL = 'true';
    const { server, lines } = await app();
    close = () => server.close();
    server.get('/cf', async (req) => {
      await verifyCfAccessAuth(req);
      return { ok: true };
    });
    const res = await server.inject({
      method: 'GET',
      url: '/cf',
      headers: { [CF_ACCESS_EMAIL_HEADER]: 'ada@mantu.com' },
      remoteAddress: '127.0.0.1',
    });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ statusCode: 503, message: GENERIC });
    expect(res.body).not.toContain('POLO_ALLOWED_USERS');
    expect(lines.join('\n')).toContain('POLO_ALLOWED_USERS');
  });

  it('does not name CLERK_SECRET_KEY for a signed-in clerk request', async () => {
    process.env.NODE_ENV = 'production';
    process.env.CLERK_SECRET_KEY = 'sk_test_audience';
    process.env.PUBLIC_BASE_URL = 'https://app.bidstack.test';
    delete process.env.DEMO_MODE;
    delete process.env.CF_ACCESS_AUTH;
    const { server, lines } = await app();
    close = () => server.close();
    await server.register(authPlugin);
    server.get('/private', async () => ({ ok: true }));
    delete process.env.CLERK_SECRET_KEY;
    const res = await server.inject({
      method: 'GET',
      url: '/private',
      headers: { authorization: 'Bearer present' },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ statusCode: 503, message: GENERIC });
    expect(res.body).not.toContain('CLERK_SECRET_KEY');
    expect(lines.join('\n')).toContain('CLERK_SECRET_KEY');
  });

  it('does not name PUBLIC_BASE_URL for a signed-in clerk request', async () => {
    process.env.NODE_ENV = 'production';
    process.env.CLERK_SECRET_KEY = 'sk_test_audience';
    delete process.env.PUBLIC_BASE_URL;
    delete process.env.DEMO_MODE;
    delete process.env.CF_ACCESS_AUTH;
    const { server, lines } = await app();
    close = () => server.close();
    await server.register(authPlugin);
    server.get('/private', async () => ({ ok: true }));
    const res = await server.inject({
      method: 'GET',
      url: '/private',
      headers: { authorization: 'Bearer present' },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ statusCode: 503, message: GENERIC });
    expect(res.body).not.toContain('PUBLIC_BASE_URL');
    expect(lines.join('\n')).toContain('PUBLIC_BASE_URL');
  });
});

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
