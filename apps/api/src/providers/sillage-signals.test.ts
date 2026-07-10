import { describe, expect, it, vi } from 'vitest';

import { fetchSillageAccountSignals, probeSillageConnectivity } from './sillage-signals.js';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
}

function sseResponse(bodyText: string): Response {
  return new Response(bodyText, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
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

  it('echoes the protocol version the MCP server negotiated on subsequent requests', async () => {
    let toolsCallProtocolHeader: string | undefined;
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { method: string };
      if (body.method === 'initialize') {
        // Server negotiates DOWN from our pinned 2025-06-18 -- the client must
        // echo exactly what the server picked, not its own pinned constant.
        return jsonResponse({ result: { protocolVersion: '2025-03-26' } });
      }
      if (body.method === 'notifications/initialized') return jsonResponse({}, { status: 202 });
      toolsCallProtocolHeader = (init?.headers as Record<string, string>)['MCP-Protocol-Version'];
      return jsonResponse({ result: { structuredContent: { signals: [] } } });
    }) as unknown as typeof fetch;

    await fetchSillageAccountSignals({
      companyName: 'Version Co',
      mcpUrl: 'https://sillage.example/mcp-version',
      fetchImpl,
    });

    expect(toolsCallProtocolHeader).toBe('2025-03-26');
  });

  it('reassembles an SSE event whose JSON payload spans multiple data: lines', async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { method: string; id?: number };
      if (body.method === 'initialize') return jsonResponse({ result: {} });
      if (body.method === 'notifications/initialized') return jsonResponse({}, { status: 202 });
      // The SSE spec lets one event's payload span several `data:` lines that
      // must be re-joined with '\n' before parsing -- a single-data-line
      // reader would see only the fragment and fail to parse valid JSON.
      return sseResponse(
        [
          'event: message',
          `data: {"jsonrpc":"2.0","id":${body.id},`,
          'data: "result":{"structuredContent":{"signals":[],"intentScore":33}}}',
          '',
          '',
        ].join('\n'),
      );
    }) as unknown as typeof fetch;

    const result = await fetchSillageAccountSignals({
      companyName: 'Multiline Co',
      mcpUrl: 'https://sillage.example/mcp-multiline',
      fetchImpl,
    });

    expect(result.source).toBe('mcp');
    expect(result.error).toBeUndefined();
    expect(result.intentScore).toBe(33);
  });

  it('picks the response frame matching the request id over a trailing notification frame', async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { method: string; id?: number };
      if (body.method === 'initialize') return jsonResponse({ result: {} });
      if (body.method === 'notifications/initialized') return jsonResponse({}, { status: 202 });
      // A server-initiated notification frame following the real response --
      // "last frame wins" (the pre-hardening behavior) would pick this
      // resultless notification instead of the matching response above it.
      return sseResponse(
        [
          `data: {"jsonrpc":"2.0","id":${body.id},"result":{"structuredContent":{"signals":[],"intentScore":21}}}`,
          '',
          'data: {"jsonrpc":"2.0","method":"notifications/message","params":{}}',
          '',
          '',
        ].join('\n'),
      );
    }) as unknown as typeof fetch;

    const result = await fetchSillageAccountSignals({
      companyName: 'Notify Co',
      mcpUrl: 'https://sillage.example/mcp-notify-order',
      fetchImpl,
    });

    expect(result.source).toBe('mcp');
    expect(result.error).toBeUndefined();
    expect(result.intentScore).toBe(21);
  });

  it('reuses the cached MCP session across sequential calls (only one initialize)', async () => {
    let initializeCount = 0;
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { method: string };
      if (body.method === 'initialize') {
        initializeCount += 1;
        return jsonResponse({ result: {} });
      }
      if (body.method === 'notifications/initialized') return jsonResponse({}, { status: 202 });
      return jsonResponse({ result: { structuredContent: { signals: [] } } });
    }) as unknown as typeof fetch;

    const input = { companyName: 'Reuse Co', mcpUrl: 'https://sillage.example/mcp-reuse', fetchImpl };
    await fetchSillageAccountSignals(input);
    await fetchSillageAccountSignals(input);

    // Second call must perform only tools/call -- no second initialize.
    expect(initializeCount).toBe(1);
  });

  it('recovers from an expired MCP session with one re-initialize and retry', async () => {
    let initializeCount = 0;
    let toolsCallCount = 0;
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { method: string };
      if (body.method === 'initialize') {
        initializeCount += 1;
        return jsonResponse({ result: {} });
      }
      if (body.method === 'notifications/initialized') return jsonResponse({}, { status: 202 });
      toolsCallCount += 1;
      // First tools/call lands on a session the server has already expired;
      // the client must drop it, re-initialize once, and retry once.
      if (toolsCallCount === 1) return new Response('session expired', { status: 404 });
      return jsonResponse({ result: { structuredContent: { signals: [], intentScore: 12 } } });
    }) as unknown as typeof fetch;

    const result = await fetchSillageAccountSignals({
      companyName: 'Expiry Co',
      mcpUrl: 'https://sillage.example/mcp-expiry',
      fetchImpl,
    });

    expect(result.source).toBe('mcp');
    expect(result.error).toBeUndefined();
    expect(result.intentScore).toBe(12);
    expect(initializeCount).toBe(2);
    expect(toolsCallCount).toBe(2);
  });

  it('honors a REST signals path override', async () => {
    let requestedPath: string | undefined;
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
      requestedPath = new URL(String(url)).pathname;
      return jsonResponse({ signals: [] });
    }) as unknown as typeof fetch;

    await fetchSillageAccountSignals({
      companyName: 'Path Co',
      mcpUrl: undefined,
      apiKey: 'k',
      baseUrl: 'https://api.sillage.example',
      restSignalsPath: '/custom/path',
      fetchImpl,
    });

    expect(requestedPath).toBe('/custom/path');
  });
});

describe('probeSillageConnectivity', () => {
  it('reports ok on a successful MCP initialize handshake', async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { method: string };
      if (body.method === 'initialize') return jsonResponse({ result: {} });
      return jsonResponse({}, { status: 202 });
    }) as unknown as typeof fetch;

    const result = await probeSillageConnectivity({
      mcpUrl: 'https://sillage.example/mcp-probe-ok',
      fetchImpl,
    });

    expect(result).toMatchObject({ ok: true, lane: 'mcp' });
    expect(typeof result.latencyMs).toBe('number');
  });

  it('reports failure when the MCP initialize handshake errors', async () => {
    const fetchImpl = vi.fn(async () => new Response('boom', { status: 500 })) as unknown as typeof fetch;

    const result = await probeSillageConnectivity({
      mcpUrl: 'https://sillage.example/mcp-probe-fail',
      fetchImpl,
    });

    expect(result.ok).toBe(false);
    expect(result.lane).toBe('mcp');
    expect(result.error).toBeDefined();
  });

  it('probes the REST lane when only an API key is configured', async () => {
    const fetchImpl = mockFetch({ signals: [] });

    const result = await probeSillageConnectivity({ mcpUrl: undefined, apiKey: 'k', fetchImpl });

    expect(result).toMatchObject({ ok: true, lane: 'rest' });
  });
});
