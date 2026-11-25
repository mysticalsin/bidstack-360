// Route-level tests for /api/integrations/erp/*. We mock fetch directly
// (the ErpMcpClient uses the global fetch) so we don't need a real Python
// mcp-server-erp running.

import sensible from '@fastify/sensible';
import Fastify from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { checkSerumConnectorRuntimePolicy } from '@bidstack/db/serum-runtime-policy';
import { prisma } from '@bidstack/db';

import { rbacPlugin } from '../plugins/rbac.js';
import { clearRbacDecisionCacheForTest } from '../lib/rbac-decision-cache.js';
import { __resetErpClient, erpRoutes } from './erp-integration.js';

vi.mock('@bidstack/db/serum-runtime-policy', () => ({
  SERUM_RUNTIME_CONFIG_KEYS: {
    connectors: 'registry',
  },
  checkSerumConnectorRuntimePolicy: vi.fn(),
  recordSerumConnectorConnectionTest: vi.fn(),
}));

// Every ERP route gates on integrations:read (audit fix: routes were auth-only
// before). Mock the RBAC decision cache's DB read so the caller in these tests
// is always granted that permission — the gate itself is exercised separately
// in rbac-matrix.test.ts. Also stub the models searchLocalCompanies reads
// (company-autocomplete's local-BidStack-records fallback) — previously this
// suite ran that query against a real DB (dotenv-flow-loaded DATABASE_URL) and
// got back an empty set for the fake test org; mocking @bidstack/db for the
// RBAC gate would otherwise make those calls throw on an undefined model.
vi.mock('@bidstack/db', () => ({
  prisma: {
    userRole: {
      count: vi.fn(),
    },
    companyEnrichment: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    opportunity: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
}));

const checkConnector = vi.mocked(checkSerumConnectorRuntimePolicy);
const userRoleCount = vi.mocked(prisma.userRole.count);
const companyFindMany = vi.mocked(prisma.companyEnrichment.findMany);
const opportunityFindMany = vi.mocked(prisma.opportunity.findMany);

// Two verified companies plus one opportunity customer. A VAT-only or
// DUNS-only lookup must return the registry hit, not this whole book.
function seedRegistryPartnerBook() {
  companyFindMany.mockResolvedValue([
    {
      id: '11111111-1111-4111-8111-111111111111',
      legalName: 'Northwind Demo SAS',
      tradeName: 'Northwind',
      domain: 'northwind.example',
      website: 'https://northwind.example',
      registryIds: { vat: 'FR 44 123 456 789', duns: '111222333' },
      confidenceBps: 8000,
    },
    {
      id: '22222222-2222-4222-8222-222222222222',
      legalName: 'Contoso Demo GmbH',
      tradeName: 'Contoso',
      domain: 'contoso.example',
      website: 'https://contoso.example',
      registryIds: { VAT: 'DE999', duns: '999888777' },
      confidenceBps: 7000,
    },
  ] as never);
  opportunityFindMany.mockResolvedValue([
    {
      customer: 'Fabrikam Demo',
      name: 'Fabrikam staffing bid',
      logoUrl: null,
    },
  ] as never);
}

function clearRegistryPartnerBook() {
  companyFindMany.mockReset();
  companyFindMany.mockResolvedValue([]);
  opportunityFindMany.mockReset();
  opportunityFindMany.mockResolvedValue([]);
}

const TEST_ORG_ID = '00000000-0000-4000-8000-000000000001';
const TEST_USER_ID = '00000000-0000-4000-8000-000000000002';

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
  app.addHook('preHandler', async (req) => {
    (req as typeof req & { auth: { orgId: string; userId: string } }).auth = {
      orgId: TEST_ORG_ID,
      userId: TEST_USER_ID,
    };
  });
  await app.register(sensible);
  await app.register(rbacPlugin);
  await app.register(erpRoutes, { prefix: '/api/integrations' });
  return app;
}

describe('erp-integration route', () => {
  beforeEach(() => {
    checkConnector.mockResolvedValue({
      configType: 'connectors',
      configKey: 'registry',
      environment: 'dev',
      subject: 'erp.test:odoo',
      allowed: true,
      status: 'allowed',
      reason: 'Connector operation is allowed by the active SERUM policy.',
      activeConfigVersionId: '00000000-0000-4000-8000-000000000099',
    });
    // Every route in this file gates on integrations:read; grant it by default
    // so these tests exercise ERP proxy behavior, not the RBAC gate itself
    // (that's rbac-matrix.test.ts's job). Clear the decision cache first —
    // it's a module-level Map keyed on the same org/user tuple every test uses.
    clearRbacDecisionCacheForTest();
    userRoleCount.mockResolvedValue(1);
    __resetErpClient();
    process.env.ERP_MCP_URL = 'http://erp.test/mcp';
    process.env.ERP_DB = 'mantu-prod';
  });
  afterEach(() => {
    delete process.env.ERP_MCP_URL;
    delete process.env.ERP_DB;
    delete process.env.ERP_MCP_BEARER_TOKEN;
    delete process.env.ODOO_MCP_URL;
    delete process.env.ODOO_DB;
    delete process.env.ODOO_MCP_BEARER_TOKEN;
    vi.unstubAllGlobals();
    checkConnector.mockReset();
    userRoleCount.mockReset();
    __resetErpClient();
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
    const res = await app.inject({ method: 'GET', url: '/api/integrations/erp/status' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      configured: true,
      url: 'http://erp.test/mcp',
      database: 'mantu-prod',
      reachable: true,
      toolCount: 2,
      lastError: null,
    });
  });

  it('reports configured + unreachable + error when the MCP server is down', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('boom')));

    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/integrations/erp/status' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { reachable: boolean; lastError: string | null };
    expect(body.reachable).toBe(false);
    expect(body.lastError).toMatch(/boom/i);
  });

  it('reports not-configured when ERP_MCP_URL is unset', async () => {
    delete process.env.ERP_MCP_URL;
    delete process.env.ODOO_MCP_URL;
    __resetErpClient();
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/integrations/erp/status' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ configured: false, reachable: false });
  });

  it('returns the Polo PreSales presales kit even when ERP is not configured', async () => {
    delete process.env.ERP_MCP_URL;
    delete process.env.ODOO_MCP_URL;
    __resetErpClient();
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/integrations/erp/presales-kit',
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
    expect(body.nextActions.join(' ')).toMatch(/ERP_MCP_URL/i);
  });

  it('uses ERP MCP company autocomplete when the sidecar is configured', async () => {
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
                email: 'hello@example.test',
              },
            ],
          },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/integrations/erp/company-autocomplete?q=Mantu&domain=mantu.com',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      configured: true,
      reachable: true,
      source: 'external_erp',
      items: [
        {
          id: 'external_erp:7',
          name: 'Mantu',
          legalName: 'Mantu',
          domain: 'mantu.com',
          vat: 'FR123',
          duns: '123456789',
          source: 'external_erp',
        },
      ],
    });
  });

  it('company autocomplete fails loud but harmlessly when no sidecar or auth context exists', async () => {
    delete process.env.ERP_MCP_URL;
    delete process.env.ODOO_MCP_URL;
    __resetErpClient();
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/integrations/erp/company-autocomplete?q=Mantu',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      configured: false,
      reachable: false,
      source: 'none',
      items: [],
      warnings: ['ERP MCP is not configured; using local Polo PreSales records.'],
    });
  });

  it('returns only the registry hit for a VAT-only or DUNS-only partner lookup', async () => {
    // WHY: with ERP unset, a vat or duns query has no local where clause, so
    // the route lists every company and every opportunity customer. A registry
    // lookup is a match, not a browse of the demo book.
    delete process.env.ERP_MCP_URL;
    delete process.env.ODOO_MCP_URL;
    __resetErpClient();
    seedRegistryPartnerBook();
    companyFindMany.mockClear();
    opportunityFindMany.mockClear();
    try {
      const app = await buildApp();
      const vatRes = await app.inject({
        method: 'GET',
        url: '/api/integrations/erp/company-autocomplete?vat=FR%2044%20123%20456%20789',
      });
      expect(vatRes.statusCode).toBe(200);
      const vatBody = vatRes.json() as {
        source: string;
        items: Array<{ name: string; matchKeys: string[] }>;
      };
      expect(vatBody.source).toBe('local');
      expect(vatBody.items.map((item) => item.name)).toEqual(['Northwind']);
      expect(vatBody.items[0]?.matchKeys).toContain('vat');

      const upperVatRes = await app.inject({
        method: 'GET',
        url: '/api/integrations/erp/company-autocomplete?vat=de999',
      });
      expect(upperVatRes.statusCode).toBe(200);
      expect(
        (upperVatRes.json() as { items: Array<{ name: string }> }).items.map((item) => item.name),
      ).toEqual(['Contoso']);

      const dunsRes = await app.inject({
        method: 'GET',
        url: '/api/integrations/erp/company-autocomplete?duns=999888777',
      });
      expect(dunsRes.statusCode).toBe(200);
      const dunsBody = dunsRes.json() as {
        source: string;
        items: Array<{ name: string; matchKeys: string[] }>;
      };
      expect(dunsBody.source).toBe('local');
      expect(dunsBody.items.map((item) => item.name)).toEqual(['Contoso']);
      expect(dunsBody.items[0]?.matchKeys).toContain('duns');

      const bothRes = await app.inject({
        method: 'GET',
        url: '/api/integrations/erp/company-autocomplete?vat=FR44123456789&duns=111222333',
      });
      expect(bothRes.statusCode).toBe(200);
      expect(
        (bothRes.json() as { items: Array<{ name: string }> }).items.map((item) => item.name),
      ).toEqual(['Northwind']);

      expect(opportunityFindMany).not.toHaveBeenCalled();
    } finally {
      clearRegistryPartnerBook();
    }
  });

  it('returns no companies when a VAT or DUNS matches nobody in the local book', async () => {
    // WHY: a miss, a short DUNS, or a VAT and DUNS from two different
    // companies must not fall through to the rest of the book.
    delete process.env.ERP_MCP_URL;
    delete process.env.ODOO_MCP_URL;
    __resetErpClient();
    seedRegistryPartnerBook();
    try {
      const app = await buildApp();
      for (const url of [
        '/api/integrations/erp/company-autocomplete?vat=GB000000000',
        '/api/integrations/erp/company-autocomplete?duns=111',
        '/api/integrations/erp/company-autocomplete?vat=FR44123456789&duns=999888777',
      ]) {
        const res = await app.inject({ method: 'GET', url });
        expect(res.statusCode).toBe(200);
        const body = res.json() as { source: string; items: Array<{ name: string }> };
        expect(body.source).toBe('none');
        expect(body.items).toEqual([]);
      }
    } finally {
      clearRegistryPartnerBook();
    }
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
      url: '/api/integrations/erp/search',
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

  it('blocks ERP proxy calls before network egress when SERUM connector policy denies', async () => {
    checkConnector.mockResolvedValueOnce({
      configType: 'connectors',
      configKey: 'registry',
      environment: 'dev',
      subject: 'erp.search:odoo',
      allowed: false,
      status: 'not_configured',
      reason: 'No active SERUM Connectors policy is published.',
      activeConfigVersionId: null,
    });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/integrations/erp/search',
      payload: {
        model: 'res.partner',
        fields: ['name'],
        limit: 5,
      },
    });

    expect(res.statusCode).toBe(403);
    expect(res.body).toContain('SERUM connector policy denied');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // Audit fix regression: these routes were auth-only (no requirePermission /
  // requireRole gate), so any authenticated caller — regardless of role —
  // could read through to the single shared ERP connection. Both a GET and
  // the POST /search route are checked so the gate isn't just wired on one verb.
  it('rejects a caller without integrations:read before any ERP/network work', async () => {
    userRoleCount.mockResolvedValue(0);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const app = await buildApp();
    const statusRes = await app.inject({ method: 'GET', url: '/api/integrations/erp/status' });
    expect(statusRes.statusCode).toBe(403);

    const searchRes = await app.inject({
      method: 'POST',
      url: '/api/integrations/erp/search',
      payload: { model: 'res.partner', fields: ['name'], limit: 5 },
    });
    expect(searchRes.statusCode).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 502 Bad Gateway when an allowed-model query fails upstream', async () => {
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
            error: { code: -32603, message: 'upstream exploded' },
          }),
        ),
    );

    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/integrations/erp/search',
      payload: { model: 'res.partner' },
    });
    expect(res.statusCode).toBe(502);
    // Error message must not echo internal ERP URL or upstream detail.
    const body = res.json() as { message?: string };
    expect(body.message).toBe('ERP MCP unavailable');
  });

  it('rejects models outside the allow-list with 400 before reaching ERP', async () => {
    // No fetch stub — if the route reaches the MCP client this test fails by
    // calling un-mocked fetch and timing out. The body-validation gate must
    // refuse `res.users` (off allow-list) before any network egress.
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/integrations/erp/search',
      payload: { model: 'res.users' },
    });
    expect(res.statusCode).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
