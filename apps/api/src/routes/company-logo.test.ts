import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { companyLogoRoutes } from './company-logo.js';

const app = Fastify();
const PNG = new Uint8Array(256).fill(7);

function image(): Response {
  return new Response(PNG, { status: 200, headers: { 'content-type': 'image/png' } });
}

beforeAll(async () => {
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(companyLogoRoutes, { prefix: '/api/v1' });
  await app.ready();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(async () => {
  await app.close();
});

describe('GET /logo negative cache', () => {
  it('does not cache an upstream outage: the next request fetches again', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNRESET')));
    const first = await app.inject({ method: 'GET', url: '/api/v1/logo?tech=outage-then-ok' });
    expect(first.statusCode).toBe(404);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(image()));
    const second = await app.inject({ method: 'GET', url: '/api/v1/logo?tech=outage-then-ok' });
    expect(second.statusCode).toBe(200);
    expect(second.headers['content-type']).toBe('image/png');
  });

  it('does not cache a rate-limited or 5xx answer', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => new Response('busy', { status: 429 })),
    );
    expect(
      (await app.inject({ method: 'GET', url: '/api/v1/logo?tech=rate-limited' })).statusCode,
    ).toBe(404);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(image()));
    expect(
      (await app.inject({ method: 'GET', url: '/api/v1/logo?tech=rate-limited' })).statusCode,
    ).toBe(200);
  });

  it('caches a definitive miss so unknown icons are not refetched', async () => {
    const miss = vi.fn().mockImplementation(async () => new Response('', { status: 404 }));
    vi.stubGlobal('fetch', miss);
    expect((await app.inject({ method: 'GET', url: '/api/v1/logo?tech=no-such-icon' })).statusCode).toBe(404);
    const calls = miss.mock.calls.length;
    expect(calls).toBeGreaterThan(0);
    expect((await app.inject({ method: 'GET', url: '/api/v1/logo?tech=no-such-icon' })).statusCode).toBe(404);
    expect(miss.mock.calls.length).toBe(calls);
  });
});
