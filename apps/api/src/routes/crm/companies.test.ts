import { afterAll, beforeAll, describe, expect } from 'vitest';

import { prisma } from '@bidstack/db';

import { buildServer } from '../../server.js';
import {
  createIsolatedOrg,
  dropIsolatedOrg,
  useIsolatedOrgAuth,
} from '../../test-support/isolated-org.js';
import { makeSkipIfNoDb } from '../../test-support/skip-if-no-db.js';

let server: Awaited<ReturnType<typeof buildServer>>;
let dbReachable = false;
let orgId: string | null = null;
let restoreAuth: (() => void) | null = null;

const TEST_COMPANY = 'Codex Verification Labs';
const TEST_NORMALIZED = 'codex-verification-labs';
const TEST_DOMAIN = 'codex-verification.example';

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  const iso = await createIsolatedOrg('crm-companies');
  orgId = iso.orgId;
  restoreAuth = useIsolatedOrgAuth(iso.clerkOrg);

  await prisma.companyEnrichment.deleteMany({
    where: { orgId, normalizedName: TEST_NORMALIZED },
  });

  server = await buildServer();
  await server.ready();
}, 30_000);

afterAll(async () => {
  if (orgId) {
    await prisma.companyEnrichment.deleteMany({
      where: { orgId, normalizedName: TEST_NORMALIZED },
    });
    await prisma.companyFieldOverride.deleteMany({ where: { orgId } });
    await prisma.auditLog.deleteMany({
      where: {
        orgId,
        action: {
          in: [
            'company.field_override',
            'company.field_override_revert',
            'company.technical_stack_override',
            'company.technical_stack_suggestion_accept',
            'company.technical_stack_suggestion_dismiss',
            'crm.company.technical_stack_refresh',
          ],
        },
      },
    });
  }
  restoreAuth?.();
  if (server) await server.close();
  if (orgId) await dropIsolatedOrg(orgId);
  if (dbReachable) await prisma.$disconnect();
});

const skipIfNoDb = makeSkipIfNoDb(() => dbReachable && !!orgId);

describe('crm companies routes', () => {
  skipIfNoDb('GET /api/crm/companies/search returns items', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/crm/companies/search' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items.length).toBeGreaterThan(0);
  });

  skipIfNoDb('GET /api/crm/companies/search?q= filters by query', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/api/crm/companies/search?q=Mantu',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items.some((c: { name: string }) => c.name === 'Mantu')).toBe(true);
  });

  skipIfNoDb('GET /api/crm/companies/search?limit= respects the limit', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/api/crm/companies/search?limit=2',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().items.length).toBeLessThanOrEqual(2);
  });

  skipIfNoDb(
    'GET /api/crm/companies/lookup matches by domain and preserves Mantu attribution',
    async () => {
      const res = await server.inject({
        method: 'GET',
        url: '/api/crm/companies/lookup?domain=mantu.com',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.match).toBe('exact_domain');
      expect(body.company.name).toBe('Mantu');
      expect(body.company.logo.url).toBe('https://mantu.com/favicon.ico');
      expect(body.company.logo.attribution.source).toBe('official_website');
    },
  );

  skipIfNoDb('GET /api/crm/companies/lookup matches by exact name', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/api/crm/companies/lookup?name=Mantu',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.match).toBe('exact_name');
    expect(body.company.name).toBe('Mantu');
  });

  skipIfNoDb('GET /api/crm/companies/lookup with no params returns none', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/crm/companies/lookup' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.match).toBe('none');
    expect(body.company).toBeNull();
    expect(body.alternatives).toEqual([]);
  });

  skipIfNoDb('GET /api/crm/companies/lookup returns fuzzy match when no exact match', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/api/crm/companies/lookup?name=Mant',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.match).toBe('fuzzy_name');
    expect(body.company).not.toBeNull();
  });

  skipIfNoDb('GET /api/crm/companies/:id returns 404 for unknown company', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/api/crm/companies/unknown-company-12345',
    });
    expect(res.statusCode).toBe(404);
  });

  skipIfNoDb('POST /api/crm/companies/:id/enrich persists a verified data cache row', async () => {
    const res = await server.inject({
      method: 'POST',
      url: `/api/crm/companies/${TEST_NORMALIZED}/enrich`,
      payload: {
        name: TEST_COMPANY,
        domain: TEST_DOMAIN,
        website: `https://${TEST_DOMAIN}/`,
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      name: TEST_COMPANY,
      domain: TEST_DOMAIN,
      source: 'verified_data',
    });

    const row = await prisma.companyEnrichment.findUnique({
      where: { orgId_normalizedName: { orgId: orgId!, normalizedName: TEST_NORMALIZED } },
    });
    expect(row?.domain).toBe(TEST_DOMAIN);
    expect(row?.confidenceBps).toBe(7200);
  });

  skipIfNoDb('POST /api/crm/companies/:id/enrich rejects invalid payload', async () => {
    const res = await server.inject({
      method: 'POST',
      url: `/api/crm/companies/${TEST_NORMALIZED}/enrich`,
      payload: {
        // missing required name
        domain: TEST_DOMAIN,
      },
    });
    expect(res.statusCode).toBe(400);
  });

  skipIfNoDb(
    'POST /api/crm/companies/autopopulate-from-sales enriches external CRM-compatible customers',
    async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/api/crm/companies/autopopulate-from-sales',
        payload: { limit: 3, source: 'opportunities' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.requested).toBeGreaterThan(0);
      expect(body.items.length).toBeGreaterThan(0);
      expect(body.enriched + body.cached + body.skipped).toBe(body.requested);
      expect(body.sourceAttribution).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ source: 'external_erp_crm_sales_autopopulate' }),
          expect.objectContaining({ source: 'external_crm_core_objects' }),
        ]),
      );
      expect(body.items[0].company).toEqual(
        expect.objectContaining({
          name: expect.any(String),
          source: 'verified_data',
          sourceAttribution: expect.any(Array),
        }),
      );
    },
  );

  skipIfNoDb(
    'POST /api/crm/companies/autopopulate-from-sales defaults limit and source',
    async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/api/crm/companies/autopopulate-from-sales',
        payload: {},
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.requested).toBeGreaterThan(0);
      expect(body.items.length).toBeGreaterThan(0);
    },
  );
  skipIfNoDb('field override moves the KPI to Internal Data and survives revert', async () => {
    // WHY: the account-view contract says an edited Apollo field is INTERNAL
    // data flagged as manually overridden — never silently mixed back in.
    const put = await server.inject({
      method: 'PUT',
      url: '/api/crm/companies/Mantu/field-overrides',
      payload: { fieldKey: 'industry', value: 'Aerospace & Defense' },
    });
    expect(put.statusCode).toBe(200);

    const cockpit = await server.inject({ method: 'GET', url: '/api/crm/companies/mantu' });
    expect(cockpit.statusCode).toBe(200);
    const kpis = (cockpit.json() as { kpis: Array<Record<string, unknown>> }).kpis;
    const industry = kpis.find((k) => k.label === 'Industry');
    expect(industry?.value).toBe('Aerospace & Defense');
    expect(industry?.block).toBe('internal');
    expect(industry?.overridden).toBe(true);

    const audit = await prisma.auditLog.findFirst({
      where: { orgId: orgId!, action: 'company.field_override', targetId: 'mantu' },
    });
    expect(audit).not.toBeNull();

    const del = await server.inject({
      method: 'DELETE',
      url: '/api/crm/companies/Mantu/field-overrides/industry',
    });
    expect(del.statusCode).toBe(204);
    const after = await server.inject({ method: 'GET', url: '/api/crm/companies/mantu' });
    const industryAfter = (after.json() as { kpis: Array<Record<string, unknown>> }).kpis.find(
      (k) => k.label === 'Industry',
    );
    expect(industryAfter?.overridden).toBeUndefined();
    expect(industryAfter?.block).toBe('external');
  });

  skipIfNoDb('manual technical stack persists into the account cockpit', async () => {
    const put = await server.inject({
      method: 'PUT',
      url: '/api/crm/companies/Mantu/technical-stack',
      payload: {
        stack: [
          {
            label: 'Data',
            items: [{ name: 'Snowflake', source: 'manual', confidence: 1 }],
          },
        ],
      },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().effectiveStack).toEqual([
      {
        label: 'Data',
        items: [{ name: 'Snowflake', source: 'manual', confidence: 1 }],
      },
    ]);

    const state = await server.inject({
      method: 'GET',
      url: '/api/crm/companies/Mantu/technical-stack',
    });
    expect(state.statusCode).toBe(200);
    expect(state.json().manualStack[0].items[0].name).toBe('Snowflake');

    const cockpit = await server.inject({ method: 'GET', url: '/api/crm/companies/mantu' });
    expect(cockpit.statusCode).toBe(200);
    expect(cockpit.json().technicalStack).toEqual([
      {
        label: 'Data',
        items: [{ name: 'Snowflake', source: 'manual', confidence: 1 }],
      },
    ]);
  });

  skipIfNoDb(
    'POST /api/crm/companies/:id/technical-stack/refresh returns source statuses',
    async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/api/crm/companies/Mantu/technical-stack/refresh',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.state.companyKey).toBe('mantu');
      expect(body.providers.map((provider: { id: string }) => provider.id)).toEqual([
        'apollo',
        'seamless',
        'tech_intel',
        'open_data',
      ]);
      expect(body.providers).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'apollo', label: 'Apollo' }),
          expect.objectContaining({ id: 'seamless', label: 'Seamless.AI' }),
          expect.objectContaining({ id: 'tech_intel', label: 'Tech Intel MCP' }),
          expect.objectContaining({ id: 'open_data', label: 'Open data' }),
        ]),
      );
    },
  );

  skipIfNoDb('technical stack refresh names configured Tech Intel MCP sources', async () => {
    const previousSourceIds = process.env.TECH_STACK_MCP_SOURCE_IDS;
    const previousBuiltWithUrl = process.env.TECH_STACK_MCP_BUILTWITH_URL;
    const previousBuiltWithLabel = process.env.TECH_STACK_MCP_BUILTWITH_LABEL;
    const previousWappalyzerUrl = process.env.TECH_STACK_MCP_WAPPALYZER_URL;
    const previousWappalyzerLabel = process.env.TECH_STACK_MCP_WAPPALYZER_LABEL;

    process.env.TECH_STACK_MCP_SOURCE_IDS = 'builtwith,wappalyzer';
    process.env.TECH_STACK_MCP_BUILTWITH_URL = 'https://builtwith.example/mcp';
    process.env.TECH_STACK_MCP_BUILTWITH_LABEL = 'BuiltWith MCP';
    process.env.TECH_STACK_MCP_WAPPALYZER_URL = 'https://wappalyzer.example/mcp';
    process.env.TECH_STACK_MCP_WAPPALYZER_LABEL = 'Wappalyzer MCP';

    try {
      const res = await server.inject({
        method: 'POST',
        url: '/api/crm/companies/Mantu/technical-stack/refresh',
      });

      expect(res.statusCode).toBe(200);
      const techIntel = res
        .json()
        .providers.find((provider: { id: string }) => provider.id === 'tech_intel');
      expect(techIntel).toMatchObject({
        id: 'tech_intel',
        label: 'BuiltWith MCP + Wappalyzer MCP',
        transport: 'mcp',
      });
    } finally {
      if (previousSourceIds === undefined) delete process.env.TECH_STACK_MCP_SOURCE_IDS;
      else process.env.TECH_STACK_MCP_SOURCE_IDS = previousSourceIds;
      if (previousBuiltWithUrl === undefined) delete process.env.TECH_STACK_MCP_BUILTWITH_URL;
      else process.env.TECH_STACK_MCP_BUILTWITH_URL = previousBuiltWithUrl;
      if (previousBuiltWithLabel === undefined) delete process.env.TECH_STACK_MCP_BUILTWITH_LABEL;
      else process.env.TECH_STACK_MCP_BUILTWITH_LABEL = previousBuiltWithLabel;
      if (previousWappalyzerUrl === undefined) delete process.env.TECH_STACK_MCP_WAPPALYZER_URL;
      else process.env.TECH_STACK_MCP_WAPPALYZER_URL = previousWappalyzerUrl;
      if (previousWappalyzerLabel === undefined) delete process.env.TECH_STACK_MCP_WAPPALYZER_LABEL;
      else process.env.TECH_STACK_MCP_WAPPALYZER_LABEL = previousWappalyzerLabel;
    }
  });

  skipIfNoDb('technical stack refresh flags partial Apollo MCP configuration', async () => {
    const previousApolloApiKey = process.env.APOLLO_API_KEY;
    const previousApolloMcpUrl = process.env.APOLLO_MCP_URL;
    const previousApolloMcpBearerToken = process.env.APOLLO_MCP_BEARER_TOKEN;
    delete process.env.APOLLO_API_KEY;
    process.env.APOLLO_MCP_URL = 'https://mcp.apollo.test/mcp';
    delete process.env.APOLLO_MCP_BEARER_TOKEN;

    try {
      const res = await server.inject({
        method: 'POST',
        url: '/api/crm/companies/Mantu/technical-stack/refresh',
      });

      expect(res.statusCode).toBe(200);
      const apollo = res
        .json()
        .providers.find((provider: { id: string }) => provider.id === 'apollo');
      expect(apollo).toMatchObject({
        id: 'apollo',
        status: 'unavailable',
        transport: null,
        message: expect.stringContaining('partially configured'),
      });
    } finally {
      if (previousApolloApiKey === undefined) delete process.env.APOLLO_API_KEY;
      else process.env.APOLLO_API_KEY = previousApolloApiKey;
      if (previousApolloMcpUrl === undefined) delete process.env.APOLLO_MCP_URL;
      else process.env.APOLLO_MCP_URL = previousApolloMcpUrl;
      if (previousApolloMcpBearerToken === undefined) delete process.env.APOLLO_MCP_BEARER_TOKEN;
      else process.env.APOLLO_MCP_BEARER_TOKEN = previousApolloMcpBearerToken;
    }
  });
});
