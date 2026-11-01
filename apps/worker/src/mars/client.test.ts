import { describe, expect, it } from 'vitest';

import { httpMarsClient, marsClientFromEnv, MarsHttpError, MarsRateLimitedError } from './client.js';

type Call = { url: string; method: string; headers: Record<string, string>; body?: string };
function fakeFetch(responses: Array<{ status: number; body?: unknown; headers?: Record<string, string> }>) {
  const calls: Call[] = [];
  const impl = async (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => {
    calls.push({ url, method: init.method, headers: init.headers, ...(init.body ? { body: init.body } : {}) });
    const r = responses.shift() ?? { status: 500 };
    return { ok: r.status >= 200 && r.status < 300, status: r.status, headers: { get: (n: string) => r.headers?.[n.toLowerCase()] ?? null }, json: async () => r.body ?? {} };
  };
  return { impl, calls };
}

const oauth = { kind: 'oauth' as const, tokenUrl: 'https://auth.mars.example/token', clientId: 'cid', clientSecret: 'test-secret' };

describe('httpMarsClient', () => {
  it('refuses a non https base url', () => {
    expect(() => httpMarsClient({ baseUrl: 'http://mars.example', auth: { kind: 'api_key', apiKey: 'k' } })).toThrow(/https/);
  });

  it('gets a client-credentials token once and reuses it', async () => {
    const f = fakeFetch([
      { status: 200, body: { access_token: 'tok1', expires_in: 3600 } },
      { status: 200, body: { items: [{ id: 'a' }], nextCursor: 'c1', hasMore: true } },
      { status: 200, body: { items: [], nextCursor: 'c1', hasMore: false } },
    ]);
    const c = httpMarsClient({ baseUrl: 'https://mars.example/', auth: oauth }, f.impl);
    const p1 = await c.listEntries({ cursor: null, updatedSince: new Date('2026-10-01T00:00:00Z'), limit: 50 });
    expect(p1).toEqual({ items: [{ id: 'a' }], nextCursor: 'c1', hasMore: true });
    await c.listEntries({ cursor: 'c1', updatedSince: null, limit: 50 });
    expect(f.calls).toHaveLength(3);
    expect(f.calls[0]!.body).toContain('grant_type=client_credentials');
    expect(f.calls[1]!.url).toBe('https://mars.example/v1/meeting-entries?limit=50&updatedSince=2026-10-01T00%3A00%3A00.000Z');
    expect(f.calls[1]!.headers.authorization).toBe('Bearer tok1');
    expect(f.calls[2]!.url).toContain('cursor=c1');
  });

  it('refreshes the token once on 401', async () => {
    const f = fakeFetch([
      { status: 200, body: { access_token: 'old', expires_in: 3600 } },
      { status: 401 },
      { status: 200, body: { access_token: 'new', expires_in: 3600 } },
      { status: 200, body: { items: [], nextCursor: null, hasMore: false } },
    ]);
    const c = httpMarsClient({ baseUrl: 'https://mars.example', auth: oauth }, f.impl);
    await expect(c.listEntries({ cursor: null, updatedSince: null, limit: 10 })).resolves.toMatchObject({ hasMore: false });
    expect(f.calls[3]!.headers.authorization).toBe('Bearer new');
  });

  it('maps 429 to a rate-limit error with Retry-After', async () => {
    const f = fakeFetch([{ status: 429, headers: { 'retry-after': '120' } }]);
    const c = httpMarsClient({ baseUrl: 'https://mars.example', auth: { kind: 'api_key', apiKey: 'k' } }, f.impl);
    const err = await c.listEntries({ cursor: null, updatedSince: null, limit: 10 }).catch((e) => e);
    expect(err).toBeInstanceOf(MarsRateLimitedError);
    expect((err as MarsRateLimitedError).retryAfterMs).toBe(120_000);
  });

  it('maps other failures to an http error without leaking the secret', async () => {
    const f = fakeFetch([{ status: 503 }]);
    const c = httpMarsClient({ baseUrl: 'https://mars.example', auth: { kind: 'api_key', apiKey: 'super-secret-key' } }, f.impl);
    const err = await c.listEntries({ cursor: null, updatedSince: null, limit: 10 }).catch((e) => e);
    expect(err).toBeInstanceOf(MarsHttpError);
    expect(String(err.message)).not.toContain('super-secret-key');
  });
});

describe('marsClientFromEnv', () => {
  it('is not configured without a base url or credentials', () => {
    expect(marsClientFromEnv({}).configured).toBe(false);
    expect(marsClientFromEnv({ MARS_BASE_URL: 'https://mars.example' }).configured).toBe(false);
    expect(marsClientFromEnv({ MARS_BASE_URL: 'https://mars.example', MARS_API_KEY: 'k' }).configured).toBe(true);
  });
});
