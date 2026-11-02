import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { createApolloProvider, createSeamlessProvider, type ProviderContext } from './providers.js';

const FIX = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__');
const json = (name: string) => JSON.parse(readFileSync(join(FIX, name), 'utf8')) as unknown;

function recordedFetch(routes: Array<{ match: string; body: unknown }>) {
  const calls: Array<{ url: string; method: string; headers: Record<string, string> }> = [];
  const fetchImpl = async (url: string, init: RequestInit = {}): Promise<Response> => {
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((v, k) => {
      headers[k] = v;
    });
    calls.push({ url, method: (init.method ?? 'GET').toUpperCase(), headers });
    const hit = routes.find((r) => url.includes(r.match));
    if (!hit) throw new Error(`http contract: unexpected URL ${url} (network blocked)`);
    return new Response(JSON.stringify(hit.body), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { fetchImpl, calls };
}

const ctx = (): ProviderContext => ({
  maxJobPages: 0,
  reserve: async () => true,
});

describe('Apollo / Seamless HTTP contract (recorded fixtures, no network)', () => {
  it('does not call Apollo when APOLLO_API_KEY is missing', async () => {
    const { fetchImpl, calls } = recordedFetch([]);
    const p = createApolloProvider({ env: {}, fetchImpl });
    const res = await p.enrich({ name: 'Acme', domain: 'acme.com' }, ctx());
    expect(res.status).toBe('not_configured');
    expect(calls).toEqual([]);
  });

  it('enriches from the recorded Apollo organization payload and sends the API key header', async () => {
    const { fetchImpl, calls } = recordedFetch([
      { match: '/organizations/enrich', body: json('apollo-organization.json') },
    ]);
    const p = createApolloProvider({ env: { APOLLO_API_KEY: 'test-key-not-real' }, fetchImpl });
    const res = await p.enrich({ name: 'Acme', domain: 'acme.com' }, ctx());
    expect(res.status).toBe('ok');
    expect(res.providerCompanyId).toBe('ap-1');
    expect(res.fields.annualRevenueUsd).toBe(125_000_000);
    expect(res.fields.employeeCount).toBe(1200);
    expect(res.linkedinUrl).toBe('https://www.linkedin.com/company/acme');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://api.apollo.io/api/v1/organizations/enrich?domain=acme.com');
    expect(calls[0]!.headers['x-api-key']).toBe('test-key-not-real');
  });

  it('does not call Seamless when SEAMLESS_API_KEY is missing', async () => {
    const { fetchImpl, calls } = recordedFetch([]);
    const p = createSeamlessProvider({ env: {}, fetchImpl });
    const res = await p.enrich({ name: 'Acme', domain: 'acme.com' }, ctx());
    expect(res.status).toBe('not_configured');
    expect(calls).toEqual([]);
  });

  it('researches then polls Seamless from recorded fixtures', async () => {
    const { fetchImpl, calls } = recordedFetch([
      { match: '/companies/research/poll', body: json('seamless-poll.json') },
      { match: '/companies/research', body: json('seamless-research.json') },
    ]);
    const p = createSeamlessProvider({
      env: { SEAMLESS_API_KEY: 'test-key-not-real' },
      fetchImpl,
      pollAttempts: 1,
      pollDelayMs: 0,
      sleep: async () => undefined,
    });
    const res = await p.enrich({ name: 'Acme', domain: 'acme.com' }, ctx());
    expect(res.status).toBe('ok');
    expect(res.providerCompanyId).toBe('sm-1');
    expect(res.fields.annualRevenueUsd).toBe(125_000_000);
    expect(calls.map((c) => c.method + ' ' + c.url)).toEqual([
      'POST https://api.seamless.ai/api/client/v1/companies/research',
      'GET https://api.seamless.ai/api/client/v1/companies/research/poll?requestIds=req-1',
    ]);
    expect(calls[0]!.headers.token ?? calls[0]!.headers.Token).toBe('test-key-not-real');
  });
});
