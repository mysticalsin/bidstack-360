// Route-level tests for /api/integrations/odoo/*. We mock fetch directly
// (the OdooMcpClient uses the global fetch) so we don't need a real Python
// mcp-server-odoo running.

import sensible from '@fastify/sensible';
import Fastify from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { __resetOdooClient, odooRoutes } from './odoo-integration.js';

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

async function buildApp() {
  const app = Fastify({ logger: false }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(sensible);
  await app.register(odooRoutes, { prefix: '/api/integrations' });
  return app;
}

describe('odoo-integration route', () => {
  beforeEach(() => {
    __resetOdooClient();
    process.env.ODOO_MCP_URL = 'http://odoo.test/mcp';
    process.env.ODOO_DB = 'mantu-prod';
  });
  afterEach(() => {
    delete process.env.ODOO_MCP_URL;
    delete process.env.ODOO_DB;
    delete process.env.ODOO_MCP_BEARER_TOKEN;
    vi.unstubAllGlobals();
    __resetOdooClient();
  });

  it('reports configured + reachable when the MCP server answers tools/list', async () => {
    // initialize -> notifications/initialized -> tools/list
    vi.stubGlobal(
      'fetch',
      vi
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
              tools: [{ name: 'search_records' }, { name: 'list_models' }],
            },
          }),
        ),
    );

    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/integrations/odoo/status' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      configured: true,
      url: 'http://odoo.test/mcp',
      database: 'mantu-prod',
      reachable: true,
      toolCount: 2,
      lastError: null,
    });
  });

  it('reports configured + unreachable + error when the MCP server is down', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('boom')));

    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/integrations/odoo/status' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { reachable: boolean; lastError: string | null };
    expect(body.reachable).toBe(false);
    expect(body.lastError).toMatch(/boom/i);
  });

  it('reports not-configured when ODOO_MCP_URL is unset', async () => {
    delete process.env.ODOO_MCP_URL;
    __resetOdooClient();
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/integrations/odoo/status' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ configured: false, reachable: false });
  });

  it('returns the BidStack presales kit even when Odoo is not configured', async () => {
    delete process.env.ODOO_MCP_URL;
    __resetOdooClient();
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/integrations/odoo/presales-kit',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      configured: boolean;
      modules: Array<{ id: string; status: string }>;
      partnerAutocomplete: { inputs: string[] };
      nextActions: string[];
    };
    expect(body.configured).toBe(false);
    expect(body.modules.map((module) => module.id)).toContain('partner-autocomplete');
    expect(body.modules.map((module) => module.id)).toContain('crm-opportunities');
    expect(body.partnerAutocomplete.inputs).toEqual(
      expect.arrayContaining(['legal name', 'domain', 'VAT', 'DUNS']),
    );
    expect(body.nextActions.join(' ')).toMatch(/ODOO_MCP_URL/i);
  });

  it('uses Odoo MCP company autocomplete when the sidecar is configured', async () => {
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
            structuredContent: [
              {
                id: 7,
                name: 'Mantu',
                commercial_company_name: 'Mantu',
                website: 'https://mantu.com/',
                vat: 'FR123',
                duns: '123456789',
                phone: '+33 1 00 00 00 00',
                email: 'hello@mantu.com',
              },
            ],
          },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/integrations/odoo/company-autocomplete?q=Mantu&domain=mantu.com',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      configured: true,
      reachable: true,
      source: 'odoo',
      items: [
        {
          id: 'odoo:7',
          name: 'Mantu',
          legalName: 'Mantu',
          domain: 'mantu.com',
          vat: 'FR123',
          duns: '123456789',
          source: 'odoo',
        },
      ],
    });
  });

  it('company autocomplete fails loud but harmlessly when no sidecar or auth context exists', async () => {
    delete process.env.ODOO_MCP_URL;
    __resetOdooClient();
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/integrations/odoo/company-autocomplete?q=Mantu',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      configured: false,
      reachable: false,
      source: 'none',
      items: [],
      warnings: ['Odoo MCP is not configured; using local BidStack records.'],
    });
  });

  it('proxies search_records and returns rows', async () => {
    vi.stubGlobal(
      'fetch',
      vi
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
              structuredContent: [
                { id: 1, name: 'Mantu' },
                { id: 2, name: 'Amaris' },
              ],
            },
          }),
        ),
    );

    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/integrations/odoo/search',
      payload: {
        model: 'res.partner',
        domain: [['is_company', '=', true]],
        fields: ['name'],
        limit: 5,
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      rows: [
        { id: 1, name: 'Mantu' },
        { id: 2, name: 'Amaris' },
      ],
    });
  });

  it('returns 502 Bad Gateway when the MCP server reports a JSON-RPC error', async () => {
    vi.stubGlobal(
      'fetch',
      vi
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
            error: { code: -32602, message: 'Unknown model res.bogus' },
          }),
        ),
    );

    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/integrations/odoo/search',
      payload: { model: 'res.bogus' },
    });
    expect(res.statusCode).toBe(502);
  });
});
