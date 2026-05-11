import pino from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OdooMcpClient, OdooMcpError } from './index.js';

const logger = pino({ level: 'silent' });

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

/**
 * The MCP streamable-http server returns either a JSON-RPC envelope (single
 * call) or an SSE stream with the same payload framed as `data: …`. We mock
 * both shapes so the client's parser branches stay exercised.
 */
function sseResponse(body: unknown, headers: Record<string, string> = {}) {
  const payload = `event: message\ndata: ${JSON.stringify(body)}\n\n`;
  return new Response(payload, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream', ...headers },
  });
}

describe('OdooMcpClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('initialises lazily and reuses the session id across calls', async () => {
    // First call → initialize (server stamps Mcp-Session-Id).
    // Second call → notifications/initialized (202).
    // Third call → tools/list with the session header echoed back.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-06-18' } }, 200, {
          'Mcp-Session-Id': 'sess-42',
        }),
      )
      .mockResolvedValueOnce(new Response('', { status: 202 }))
      .mockResolvedValueOnce(
        jsonResponse({ jsonrpc: '2.0', id: 2, result: { tools: [{ name: 'search_records' }] } }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const client = new OdooMcpClient({ url: 'http://odoo.test/mcp', logger });
    await expect(client.listTools()).resolves.toEqual([{ name: 'search_records' }]);

    // Final call carried the session id.
    const lastCall = fetchMock.mock.calls.at(-1)!;
    const lastHeaders = (lastCall[1] as RequestInit).headers as Record<string, string>;
    expect(lastHeaders['Mcp-Session-Id']).toBe('sess-42');
  });

  it('invokes search_records and returns the structuredContent payload', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ jsonrpc: '2.0', id: 1, result: {} }, 200, {
          'Mcp-Session-Id': 'sess-1',
        }),
      )
      .mockResolvedValueOnce(new Response('', { status: 202 }))
      .mockResolvedValueOnce(
        jsonResponse({
          jsonrpc: '2.0',
          id: 2,
          result: {
            content: [{ type: 'text', text: '[{"id":1,"name":"Mantu"}]' }],
            structuredContent: [{ id: 1, name: 'Mantu' }],
          },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const client = new OdooMcpClient({ url: 'http://odoo.test/mcp', logger });
    const rows = await client.searchRecords<Array<{ id: number; name: string }>>({
      model: 'res.partner',
      domain: [['is_company', '=', true]],
      fields: ['name'],
      limit: 5,
    });

    // structuredContent is preferred when present — that is the typed shape.
    expect(rows).toEqual([{ id: 1, name: 'Mantu' }]);
  });

  it('parses text content as JSON when structuredContent is absent', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ jsonrpc: '2.0', id: 1, result: {} }, 200, {
          'Mcp-Session-Id': 's',
        }),
      )
      .mockResolvedValueOnce(new Response('', { status: 202 }))
      .mockResolvedValueOnce(
        jsonResponse({
          jsonrpc: '2.0',
          id: 2,
          result: {
            content: [{ type: 'text', text: '{"id":42,"name":"Acme"}' }],
          },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const client = new OdooMcpClient({ url: 'http://odoo.test/mcp', logger });
    await expect(client.getRecord({ model: 'res.partner', id: 42 })).resolves.toEqual({
      id: 42,
      name: 'Acme',
    });
  });

  it('parses SSE responses', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ jsonrpc: '2.0', id: 1, result: {} }, 200, {
          'Mcp-Session-Id': 's',
        }),
      )
      .mockResolvedValueOnce(new Response('', { status: 202 }))
      .mockResolvedValueOnce(
        sseResponse({
          jsonrpc: '2.0',
          id: 2,
          result: { tools: [{ name: 'list_models' }] },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const client = new OdooMcpClient({ url: 'http://odoo.test/mcp', logger });
    await expect(client.listTools()).resolves.toEqual([{ name: 'list_models' }]);
  });

  it('raises a typed OdooMcpError on JSON-RPC error envelopes', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ jsonrpc: '2.0', id: 1, result: {} }, 200, {
          'Mcp-Session-Id': 's',
        }),
      )
      .mockResolvedValueOnce(new Response('', { status: 202 }))
      .mockResolvedValueOnce(
        jsonResponse({
          jsonrpc: '2.0',
          id: 2,
          error: { code: -32602, message: 'Unknown model res.bogus', data: null },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const client = new OdooMcpClient({ url: 'http://odoo.test/mcp', logger });
    await expect(client.searchRecords({ model: 'res.bogus' })).rejects.toBeInstanceOf(OdooMcpError);
  });

  it('flags tool-level errors (isError=true) as OdooMcpError', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ jsonrpc: '2.0', id: 1, result: {} }, 200, {
          'Mcp-Session-Id': 's',
        }),
      )
      .mockResolvedValueOnce(new Response('', { status: 202 }))
      .mockResolvedValueOnce(
        jsonResponse({
          jsonrpc: '2.0',
          id: 2,
          result: {
            isError: true,
            content: [{ type: 'text', text: 'Access denied to res.users' }],
          },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const client = new OdooMcpClient({ url: 'http://odoo.test/mcp', logger });
    await expect(client.searchRecords({ model: 'res.users' })).rejects.toMatchObject({
      name: 'OdooMcpError',
      message: 'Access denied to res.users',
    });
  });

  it('attaches Authorization when a bearer token is provided', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ jsonrpc: '2.0', id: 1, result: {} }, 200, {
          'Mcp-Session-Id': 's',
        }),
      )
      .mockResolvedValueOnce(new Response('', { status: 202 }))
      .mockResolvedValueOnce(jsonResponse({ jsonrpc: '2.0', id: 2, result: { tools: [] } }));
    vi.stubGlobal('fetch', fetchMock);

    const client = new OdooMcpClient({
      url: 'http://odoo.test/mcp',
      bearerToken: 'sk_proxy',
      logger,
    });
    await client.listTools();

    const firstCall = fetchMock.mock.calls[0]!;
    const headers = (firstCall[1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer sk_proxy');
  });

  it('retries on 5xx with exponential backoff', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('boom', { status: 503 }))
      .mockResolvedValueOnce(
        jsonResponse({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-06-18' } }),
      )
      .mockResolvedValueOnce(new Response('', { status: 202 }))
      .mockResolvedValueOnce(jsonResponse({ jsonrpc: '2.0', id: 2, result: { tools: [] } }));
    vi.stubGlobal('fetch', fetchMock);

    const client = new OdooMcpClient({ url: 'http://odoo.test/mcp', logger });
    const promise = client.listTools();
    // Drain the backoff timer (250ms on first retry).
    await vi.advanceTimersByTimeAsync(300);
    await expect(promise).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    vi.useRealTimers();
  });
});
