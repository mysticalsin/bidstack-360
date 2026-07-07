import { describe, expect, it, vi } from 'vitest';

import { fetchSillageAccountSignals } from './sillage-signals.js';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
}

function mockFetch(body: unknown, ok = true): typeof fetch {
  return vi.fn(async () =>
    ok ? jsonResponse(body) : new Response('error', { status: 500 }),
  ) as unknown as typeof fetch;
}

describe('fetchSillageAccountSignals', () => {
  it('prefers Sillage MCP and maps signals to source-tagged Triggers', async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { method: string };
      if (body.method === 'initialize') return jsonResponse({ result: {} });
      if (body.method === 'notifications/initialized') return jsonResponse({}, { status: 202 });
      return jsonResponse({
        result: {
          structuredContent: {
            intentScore: 78,
            signals: [
              {
                id: 'sig-1',
                category: 'hiring',
                label: 'Posted 4 new AE roles',
                priority: 82,
                observedAt: '2026-06-01T00:00:00.000Z',
              },
              {
                category: 'champion_job_change',
                label: 'Former champion moved to VP Sales',
                priority: 0.65,
                timestamp: '2026-06-15T00:00:00.000Z',
              },
            ],
          },
        },
      });
    }) as unknown as typeof fetch;

    const result = await fetchSillageAccountSignals({
      companyName: 'Acme Corp',
      domain: 'acme.com',
      mcpUrl: 'https://sillage.example/mcp',
      mcpBearerToken: 'mcp-token',
      fetchImpl,
    });

    expect(result.source).toBe('mcp');
    expect(result.error).toBeUndefined();
    expect(result.intentScore).toBe(78);
    expect(result.signals).toHaveLength(2);
    expect(result.signals[0]).toMatchObject({
      id: 'sig-1',
      kind: 'hiring',
      label: 'Posted 4 new AE roles',
      weight: 8.2,
      observedAt: '2026-06-01T00:00:00.000Z',
      source: 'sillage',
    });
    expect(result.signals[1]).toMatchObject({
      kind: 'executive_move',
      label: 'Former champion moved to VP Sales',
      weight: 6.5,
      source: 'sillage',
    });
    // initialize + notifications/initialized + tools/call
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('falls back to REST when the MCP call throws, tagging the result rest', async () => {
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).includes('sillage.example/mcp')) throw new Error('ECONNREFUSED');
      return jsonResponse({
        intentScore: 0.4,
        signals: [
          {
            category: 'funding',
            label: 'Raised Series C',
            score: 60,
            observedAt: '2026-05-01T00:00:00.000Z',
          },
        ],
      });
    }) as unknown as typeof fetch;

    const result = await fetchSillageAccountSignals({
      companyName: 'Acme Corp',
      mcpUrl: 'https://sillage.example/mcp',
      apiKey: 'rest-key',
      baseUrl: 'https://api.sillage.example',
      fetchImpl,
    });

    expect(result.source).toBe('rest');
    expect(result.error).toBeUndefined();
    // 0-1 scale normalized to a 0-100 intent score.
    expect(result.intentScore).toBe(40);
    expect(result.signals).toHaveLength(1);
    expect(result.signals[0]).toMatchObject({ kind: 'funding', label: 'Raised Series C', weight: 6 });
  });

  it('fails open to an empty result with an explanatory error when nothing is configured', async () => {
    const fetchImpl = mockFetch({});

    const result = await fetchSillageAccountSignals({
      companyName: 'Acme Corp',
      apiKey: undefined,
      mcpUrl: undefined,
      fetchImpl,
    });

    expect(result).toEqual({
      signals: [],
      intentScore: null,
      source: null,
      error: 'Sillage is not configured (set SILLAGE_API_KEY or SILLAGE_MCP_URL)',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('coerces malformed REST JSON to an empty signal list without throwing', async () => {
    const fetchImpl = mockFetch({ unexpected: 'shape', nested: [1, 2, 3] });

    const result = await fetchSillageAccountSignals({ companyName: 'Acme Corp', apiKey: 'k', fetchImpl });

    expect(result.source).toBe('rest');
    expect(result.signals).toEqual([]);
    expect(result.intentScore).toBeNull();
    expect(result.error).toBeUndefined();
  });

  it('drops rows that fail Trigger validation but keeps the valid ones', async () => {
    const fetchImpl = mockFetch({
      signals: [
        { category: 'hiring', label: 'Valid signal', priority: 50, observedAt: '2026-06-01T00:00:00.000Z' },
        { category: 'hiring', priority: 50 }, // no label -- must be dropped
      ],
    });

    const result = await fetchSillageAccountSignals({ companyName: 'Acme Corp', apiKey: 'k', fetchImpl });

    expect(result.signals).toHaveLength(1);
    expect(result.signals[0]?.label).toBe('Valid signal');
  });

  it('fails open on a non-ok REST response instead of throwing', async () => {
    const fetchImpl = mockFetch({}, false);

    const result = await fetchSillageAccountSignals({ companyName: 'Acme Corp', apiKey: 'k', fetchImpl });

    expect(result).toEqual({
      signals: [],
      intentScore: null,
      source: null,
      error: 'Sillage REST HTTP 500',
    });
  });

  it('rejects a request missing both companyName and domain before any network call', async () => {
    const fetchImpl = mockFetch({});

    const result = await fetchSillageAccountSignals({ apiKey: 'k', fetchImpl });

    expect(result).toEqual({
      signals: [],
      intentScore: null,
      source: null,
      error: 'companyName or domain is required',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
