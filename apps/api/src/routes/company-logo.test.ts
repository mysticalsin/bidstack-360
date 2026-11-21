import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const { pinnedMock } = vi.hoisted(() => ({ pinnedMock: vi.fn() }));

vi.mock('@bidstack/shared/server', () => ({
  pinnedFetch: (...args: unknown[]) => pinnedMock(...args),
  PinnedFetchError: class PinnedFetchError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.name = 'PinnedFetchError';
      this.code = code;
    }
  },
}));

import { PinnedFetchError } from '@bidstack/shared/server';

import { companyLogoRoutes } from './company-logo.js';

const app = Fastify();
const PNG = new Uint8Array(256).fill(7);

function pinned(opts: {
  status?: number;
  body?: Uint8Array;
  contentType?: string | null;
  location?: string;
}) {
  const headers = new Map<string, string>();
  if (opts.contentType) headers.set('content-type', opts.contentType);
  if (opts.location) headers.set('location', opts.location);
  return {
    status: opts.status ?? 200,
    url: '',
    pinnedAddress: '93.184.216.34',
    headers: { get: (name: string) => headers.get(name.toLowerCase()) ?? null },
    body: opts.body ?? new Uint8Array(),
    text: async () => '',
    toResponse: () => new Response(),
  };
}

beforeAll(async () => {
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(companyLogoRoutes, { prefix: '/api/v1' });
  await app.ready();
});

afterEach(() => {
  pinnedMock.mockReset();
});

afterAll(async () => {
  await app.close();
});

describe('GET /logo negative cache', () => {
  it('does not cache an upstream outage: the next request fetches again', async () => {
    pinnedMock.mockRejectedValue(new PinnedFetchError('timeout', 'timed out'));
    const first = await app.inject({ method: 'GET', url: '/api/v1/logo?tech=outage-then-ok' });
    expect(first.statusCode).toBe(404);

    pinnedMock.mockResolvedValue(pinned({ body: PNG, contentType: 'image/png' }));
    const second = await app.inject({ method: 'GET', url: '/api/v1/logo?tech=outage-then-ok' });
    expect(second.statusCode).toBe(200);
    expect(second.headers['content-type']).toBe('image/png');
    expect(second.headers['x-content-type-options']).toBe('nosniff');
  });

  it('does not cache a rate-limited or 5xx answer', async () => {
    pinnedMock.mockResolvedValue(pinned({ status: 429, body: new Uint8Array(), contentType: 'text/plain' }));
    expect((await app.inject({ method: 'GET', url: '/api/v1/logo?tech=rate-limited' })).statusCode).toBe(404);

    pinnedMock.mockResolvedValue(pinned({ body: PNG, contentType: 'image/png' }));
    expect((await app.inject({ method: 'GET', url: '/api/v1/logo?tech=rate-limited' })).statusCode).toBe(200);
  });

  it('caches a definitive miss so unknown icons are not refetched', async () => {
    pinnedMock.mockResolvedValue(pinned({ status: 404 }));
    expect((await app.inject({ method: 'GET', url: '/api/v1/logo?tech=no-such-icon' })).statusCode).toBe(404);
    const calls = pinnedMock.mock.calls.length;
    expect(calls).toBeGreaterThan(0);
    expect((await app.inject({ method: 'GET', url: '/api/v1/logo?tech=no-such-icon' })).statusCode).toBe(404);
    expect(pinnedMock.mock.calls.length).toBe(calls);
  });
});

describe('GET /logo outbound fetch (F-03, F-13)', () => {
  it('does not follow a provider redirect onto the metadata service', async () => {
    const requests: string[] = [];
    pinnedMock.mockImplementation(async (url: string) => {
      requests.push(url);
      if (url.startsWith('https://www.google.com/s2/favicons')) {
        return pinned({
          status: 302,
          contentType: 'image/png',
          location: 'http://169.254.169.254/latest/meta-data/',
        });
      }
      return pinned({ status: 404 });
    });

    const res = await app.inject({ method: 'GET', url: '/api/v1/logo?domain=brand.attacker.com' });
    expect(res.statusCode).toBe(404);
    expect(requests).not.toContain('http://169.254.169.254/latest/meta-data/');
  });

  it('serves SVG as an attachment and refuses to treat it as a document', async () => {
    const svg = new TextEncoder().encode(
      `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script>${'<!-- pad -->'.repeat(20)}</svg>`,
    );
    pinnedMock.mockResolvedValue(pinned({ body: svg, contentType: 'image/svg+xml' }));
    const res = await app.inject({ method: 'GET', url: '/api/v1/logo?tech=script-icon' });
    expect(res.statusCode).toBe(200);
    expect(String(res.headers['content-disposition'])).toContain('attachment');
    expect(String(res.headers['content-security-policy'])).toContain("default-src 'none'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-type']).toBe('image/svg+xml');
  });

  it('forces a raster content type and strips parameters', async () => {
    pinnedMock.mockResolvedValue(pinned({ body: PNG, contentType: 'image/png; charset=utf-8' }));
    const res = await app.inject({ method: 'GET', url: '/api/v1/logo?tech=forced-png' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});
