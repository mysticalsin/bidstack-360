import { describe, expect, it, vi } from 'vitest';

import { detectSillageIntent } from './sillage-intent.js';

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

describe('detectSillageIntent', () => {
  it('prefers Sillage MCP and returns a source-tagged result', async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { method: string };
      if (body.method === 'initialize') return jsonResponse({ result: {} });
      if (body.method === 'notifications/initialized') return jsonResponse({}, { status: 202 });
      return jsonResponse({
        result: { structuredContent: { intent: 'renewal_interest', confidence: 0.82 } },
      });
    }) as unknown as typeof fetch;

    const result = await detectSillageIntent({
      text: 'They asked about renewing next quarter.',
      mcpUrl: 'https://sillage.example/mcp',
      mcpBearerToken: 'mcp-token',
      fetchImpl,
    });

    expect(result).toEqual({
      intent: 'renewal_interest',
      confidence: 0.82,
      source: 'mcp',
      raw: { intent: 'renewal_interest', confidence: 0.82 },
    });
    // initialize + notifications/initialized + tools/call
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('falls back to REST when the MCP call throws, tagging the result rest', async () => {
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).includes('sillage.example/mcp')) throw new Error('ECONNREFUSED');
      return jsonResponse({ intent: 'pricing_objection', confidence: 55 });
    }) as unknown as typeof fetch;

    const result = await detectSillageIntent({
      text: 'The price is too high for our budget.',
      mcpUrl: 'https://sillage.example/mcp',
      apiKey: 'rest-key',
      baseUrl: 'https://api.sillage.example',
      fetchImpl,
    });

    expect(result.source).toBe('rest');
    expect(result.intent).toBe('pricing_objection');
    // Confidence normalized from a 0-100 scale down to 0-1.
    expect(result.confidence).toBe(0.55);
    expect(result.error).toBeUndefined();
  });

  it('fails open to a null result with an explanatory error when nothing is configured', async () => {
    const fetchImpl = mockFetch({});

    const result = await detectSillageIntent({
      text: 'hello',
      apiKey: undefined,
      mcpUrl: undefined,
      fetchImpl,
    });

    expect(result).toEqual({
      intent: null,
      confidence: null,
      source: null,
      error: 'Sillage is not configured (set SILLAGE_API_KEY or SILLAGE_MCP_URL)',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('coerces a malformed REST response to null fields without throwing', async () => {
    const fetchImpl = mockFetch({ unexpected: 'shape', nested: [1, 2, 3] });

    const result = await detectSillageIntent({ text: 'hello', apiKey: 'k', fetchImpl });

    expect(result.intent).toBeNull();
    expect(result.confidence).toBeNull();
    expect(result.source).toBe('rest');
    expect(result.error).toBeUndefined();
  });

  it('fails open on a non-ok REST response instead of throwing', async () => {
    const fetchImpl = mockFetch({}, false);

    const result = await detectSillageIntent({ text: 'hello', apiKey: 'k', fetchImpl });

    expect(result).toEqual({
      intent: null,
      confidence: null,
      source: null,
      error: 'Sillage REST HTTP 500',
    });
  });

  it('rejects blank text before any network call', async () => {
    const fetchImpl = mockFetch({});

    const result = await detectSillageIntent({ text: '   ', apiKey: 'k', fetchImpl });

    expect(result).toEqual({
      intent: null,
      confidence: null,
      source: null,
      error: 'text is required',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
