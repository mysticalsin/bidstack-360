import { afterAll, beforeAll, describe, expect } from 'vitest';

import { prisma } from '@bidstack/db';

import { buildServer } from '../../server.js';
import {
  createIsolatedOrg,
  dropIsolatedOrg,
  useIsolatedOrgAuth,
} from '../../test-support/isolated-org.js';
import { makeSkipIfNoDb } from '../../test-support/skip-if-no-db.js';
import { purgeAuditRows } from '../../test-support/purge-audit-rows.js';

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
  // WHY: search, lookup, cockpit, and overrides only resolve a company that was
  // stored. This row is that account. Mantu is not inserted.
  await prisma.companyEnrichment.create({
    data: {
      orgId,
      normalizedName: TEST_NORMALIZED,
      legalName: TEST_COMPANY,
      tradeName: TEST_COMPANY,
      domain: TEST_DOMAIN,
      website: `https://${TEST_DOMAIN}/`,
      logoUrl: null,
      logoSource: 'manual',
      registryIds: {},
      formerNames: [],
      industryCodes: ['Software'],
      status: 'active',
      employeeCount: null,
      annualRevenueMicros: null,
      confidenceBps: 7200,
      sourceAttribution: [],
      providerMetadata: {},
      cacheExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
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
    await purgeAuditRows({
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

  skipIfNoDb('GET /api/crm/companies/search?q= filters a stored company and does not invent Mantu', async () => {
    // WHY: an empty name used to be filled with a Mantu row, so a search for
    // that name returned an account the org never stored.
    const absent = await server.inject({
      method: 'GET',
      url: '/api/crm/companies/search?q=Mantu',
    });
    expect(absent.statusCode).toBe(200);
    const absentBody = absent.json();
    expect(absentBody.items.some((c: { name: string }) => c.name === 'Mantu')).toBe(false);

    const res = await server.inject({
      method: 'GET',
      url: `/api/crm/companies/search?q=${encodeURIComponent(TEST_COMPANY)}`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items.some((c: { name: string }) => c.name === TEST_COMPANY)).toBe(true);
    expect(body.items.some((c: { name: string }) => c.name === 'Mantu')).toBe(false);
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
    'GET /api/crm/companies/lookup matches a stored domain and does not invent Mantu',
    async () => {
      // WHY: mantu.com used to exact-match a fabricated row with the official
      // Mantu logo. A domain the org never stored is no match.
      const invented = await server.inject({
        method: 'GET',
        url: '/api/crm/companies/lookup?domain=mantu.com',
      });
      expect(invented.statusCode).toBe(200);
      expect(invented.json()).toMatchObject({ match: 'none', company: null, alternatives: [] });

      const res = await server.inject({
        method: 'GET',
        url: `/api/crm/companies/lookup?domain=${TEST_DOMAIN}`,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.match).toBe('exact_domain');
      expect(body.company.name).toBe(TEST_COMPANY);
      expect(body.company.domain).toBe(TEST_DOMAIN);
    },
  );

  skipIfNoDb('GET /api/crm/companies/lookup matches a stored name and does not invent Mantu', async () => {
    const invented = await server.inject({
      method: 'GET',
      url: '/api/crm/companies/lookup?name=Mantu',
    });
    expect(invented.statusCode).toBe(200);
    expect(invented.json()).toMatchObject({ match: 'none', company: null, alternatives: [] });

    const res = await server.inject({
      method: 'GET',
      url: `/api/crm/companies/lookup?name=${encodeURIComponent(TEST_COMPANY)}`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.match).toBe('exact_name');
    expect(body.company.name).toBe(TEST_COMPANY);
  });

  skipIfNoDb('GET /api/crm/companies/lookup with no params returns none', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/crm/companies/lookup' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.match).toBe('none');
    expect(body.company).toBeNull();
    expect(body.alternatives).toEqual([]);
  });

  skipIfNoDb('GET /api/crm/companies/lookup returns fuzzy match for a stored name and none for Mantu', async () => {
    // WHY: "Mant" used to fuzzy-match the fabricated Mantu row. A prefix of a
    // name the org never stored is no match; a prefix of a stored name is.
    const invented = await server.inject({
      method: 'GET',
      url: '/api/crm/companies/lookup?name=Mant',
    });
    expect(invented.statusCode).toBe(200);
    expect(invented.json()).toMatchObject({ match: 'none', company: null, alternatives: [] });

    const res = await server.inject({
      method: 'GET',
      url: '/api/crm/companies/lookup?name=Codex%20Verif',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.match).toBe('fuzzy_name');
    expect(body.company.name).toBe(TEST_COMPANY);
  });

  skipIfNoDb('GET /api/crm/companies/:id returns 404 for unknown company', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/api/crm/companies/unknown-company-12345',
    });
    expect(res.statusCode).toBe(404);
  });

  skipIfNoDb('GET /api/crm/companies/Mantu is 404 when the org has no such account', async () => {
    // WHY: the cockpit and the technical stack used to resolve an invented
    // Mantu row, so these calls returned 200 for every org.
    const cockpit = await server.inject({ method: 'GET', url: '/api/crm/companies/Mantu' });
    expect(cockpit.statusCode).toBe(404);
    const stack = await server.inject({
      method: 'GET',
      url: '/api/crm/companies/Mantu/technical-stack',
    });
    expect(stack.statusCode).toBe(404);
    const refresh = await server.inject({
      method: 'POST',
      url: '/api/crm/companies/Mantu/technical-stack/refresh',
    });
    expect(refresh.statusCode).toBe(404);
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
      url: `/api/crm/companies/${TEST_NORMALIZED}/field-overrides`,
      payload: { fieldKey: 'industry', value: 'Aerospace & Defense' },
    });
    expect(put.statusCode).toBe(200);

    const cockpit = await server.inject({ method: 'GET', url: `/api/crm/companies/${TEST_NORMALIZED}` });
    expect(cockpit.statusCode).toBe(200);
    const kpis = (cockpit.json() as { kpis: Array<Record<string, unknown>> }).kpis;
    const industry = kpis.find((k) => k.label === 'Industry');
    expect(industry?.value).toBe('Aerospace & Defense');
    expect(industry?.block).toBe('internal');
    expect(industry?.overridden).toBe(true);

    const audit = await prisma.auditLog.findFirst({
      where: { orgId: orgId!, action: 'company.field_override', targetId: TEST_NORMALIZED },
    });
    expect(audit).not.toBeNull();

    const del = await server.inject({
      method: 'DELETE',
      url: `/api/crm/companies/${TEST_NORMALIZED}/field-overrides/industry`,
    });
    expect(del.statusCode).toBe(204);
    const after = await server.inject({ method: 'GET', url: `/api/crm/companies/${TEST_NORMALIZED}` });
    const industryAfter = (after.json() as { kpis: Array<Record<string, unknown>> }).kpis.find(
      (k) => k.label === 'Industry',
    );
    expect(industryAfter?.overridden).toBeUndefined();
    expect(industryAfter?.block).toBe('external');
  });

  skipIfNoDb('field override stores its source link and label, and audits them', async () => {
    // WHY: the product owner must be able to prove every figure; a manual
    // revenue without the place it was read from is not provable.
    const put = await server.inject({
      method: 'PUT',
      url: `/api/crm/companies/${TEST_NORMALIZED}/field-overrides`,
      payload: {
        fieldKey: 'annualRevenueMicros',
        value: 1_200_000_000_000_000,
        sourceUrl: 'https://codex-verification.example/annual-report-2025.pdf',
        sourceLabel: 'Annual report 2025',
      },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toMatchObject({
      fieldKey: 'annualRevenueMicros',
      sourceUrl: 'https://codex-verification.example/annual-report-2025.pdf',
      sourceLabel: 'Annual report 2025',
    });
    const row = await prisma.companyFieldOverride.findFirst({
      where: { orgId: orgId!, companyKey: TEST_NORMALIZED, fieldKey: 'annualRevenueMicros' },
    });
    expect(row?.sourceUrl).toBe('https://codex-verification.example/annual-report-2025.pdf');
    expect(row?.sourceLabel).toBe('Annual report 2025');
    const audit = await prisma.auditLog.findFirst({
      where: { orgId: orgId!, action: 'company.field_override', targetId: TEST_NORMALIZED },
      orderBy: { id: 'desc' },
    });
    expect(audit?.diff).toMatchObject({ fieldKey: 'annualRevenueMicros', sourceUrl: 'https://codex-verification.example/annual-report-2025.pdf' });

    // Saving again without a source clears the old link: the value changed,
    // so the old source no longer proves it.
    await server.inject({
      method: 'PUT',
      url: `/api/crm/companies/${TEST_NORMALIZED}/field-overrides`,
      payload: { fieldKey: 'annualRevenueMicros', value: 1_300_000_000_000_000 },
    });
    const cleared = await prisma.companyFieldOverride.findFirst({
      where: { orgId: orgId!, companyKey: TEST_NORMALIZED, fieldKey: 'annualRevenueMicros' },
    });
    expect(cleared?.sourceUrl).toBeNull();
    await server.inject({ method: 'DELETE', url: `/api/crm/companies/${TEST_NORMALIZED}/field-overrides/annualRevenueMicros` });
  });

  skipIfNoDb('field override stores the currency of a manual revenue, EUR when none is given', async () => {
    const put = (payload: object) => server.inject({ method: 'PUT', url: `/api/crm/companies/${TEST_NORMALIZED}/field-overrides`, payload });
    const row = () => prisma.companyFieldOverride.findFirst({ where: { orgId: orgId!, companyKey: TEST_NORMALIZED, fieldKey: 'annualRevenueMicros' } });

    const usd = await put({ fieldKey: 'annualRevenueMicros', value: 2_000_000_000_000_000, currency: 'USD' });
    expect(usd.statusCode).toBe(200);
    expect(usd.json()).toMatchObject({ currency: 'USD' });
    expect((await row())?.currency).toBe('USD');
    const audit = await prisma.auditLog.findFirst({ where: { orgId: orgId!, action: 'company.field_override', targetId: TEST_NORMALIZED }, orderBy: { id: 'desc' } });
    expect(audit?.diff).toMatchObject({ currency: 'USD' });

    expect((await put({ fieldKey: 'annualRevenueMicros', value: 2_100_000_000_000_000 })).json()).toMatchObject({ currency: 'EUR' });
    expect((await row())?.currency).toBe('EUR');

    for (const currency of ['XXX', 'usd', 'US']) {
      expect((await put({ fieldKey: 'annualRevenueMicros', value: 1_000_000, currency })).statusCode).toBe(400);
    }
    // Large-company revenue (NOK 86.1bn) is above 2^53 micros and must still save.
    const big = await put({ fieldKey: 'annualRevenueMicros', value: 86_100_000_000 * 1_000_000, currency: 'NOK' });
    expect(big.statusCode, big.body).toBe(200);
    expect(Number((await row())?.value)).toBe(86_100_000_000 * 1_000_000);
    // Only revenue carries a currency.
    const emp = await put({ fieldKey: 'employeeCount', value: 500, currency: 'USD' });
    expect(emp.json()).toMatchObject({ currency: null });
    await server.inject({ method: 'DELETE', url: `/api/crm/companies/${TEST_NORMALIZED}/field-overrides/annualRevenueMicros` });
    await server.inject({ method: 'DELETE', url: `/api/crm/companies/${TEST_NORMALIZED}/field-overrides/employeeCount` });
  });

  skipIfNoDb('field override refuses a source link that is not http or https', async () => {
    for (const sourceUrl of ['javascript:alert(1)', 'ftp://files.example.com/a', 'not a url']) {
      const res = await server.inject({
        method: 'PUT',
        url: `/api/crm/companies/${TEST_NORMALIZED}/field-overrides`,
        payload: { fieldKey: 'employeeCount', value: 100, sourceUrl },
      });
      expect(res.statusCode).toBe(400);
    }
  });

  skipIfNoDb('registry number and jurisdiction can be set with a source and reverted', async () => {
    const put = await server.inject({
      method: 'PUT',
      url: `/api/crm/companies/${TEST_NORMALIZED}/field-overrides`,
      payload: {
        fieldKey: 'registryId',
        value: '  B 123 456 789 ',
        sourceUrl: 'https://annuaire-entreprises.data.gouv.fr/entreprise/123456789',
        sourceLabel: 'Annuaire des entreprises',
      },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().value).toBe('B 123 456 789');
    const jur = await server.inject({
      method: 'PUT',
      url: `/api/crm/companies/${TEST_NORMALIZED}/field-overrides`,
      payload: { fieldKey: 'registryJurisdiction', value: 'fr' },
    });
    expect(jur.statusCode).toBe(200);
    expect(jur.json().value).toBe('FR');
    const bad = await server.inject({
      method: 'PUT',
      url: `/api/crm/companies/${TEST_NORMALIZED}/field-overrides`,
      payload: { fieldKey: 'registryJurisdiction', value: 'France!' },
    });
    expect(bad.statusCode).toBe(400);
    for (const key of ['registryId', 'registryJurisdiction']) {
      const del = await server.inject({ method: 'DELETE', url: `/api/crm/companies/${TEST_NORMALIZED}/field-overrides/${key}` });
      expect(del.statusCode).toBe(204);
    }
  });

  skipIfNoDb('field override keyed by company id lands on the name key the cockpit reads', async () => {
    // WHY: the account page knows the company id, the cockpit reads overrides
    // by normalised name; an id-keyed row would never show up.
    const company = await prisma.company.create({
      data: { orgId: orgId!, name: 'Provenance Probe SA' },
      select: { id: true },
    });
    try {
      const put = await server.inject({
        method: 'PUT',
        url: `/api/crm/companies/${company.id}/field-overrides`,
        payload: { fieldKey: 'employeeCount', value: 4200, sourceUrl: 'https://example.com/facts', sourceLabel: 'Company facts' },
      });
      expect(put.statusCode).toBe(200);
      expect(put.json().companyKey).toBe('provenance-probe-sa');
      const del = await server.inject({ method: 'DELETE', url: `/api/crm/companies/${company.id}/field-overrides/employeeCount` });
      expect(del.statusCode).toBe(204);
      expect(await prisma.companyFieldOverride.count({ where: { orgId: orgId!, companyKey: 'provenance-probe-sa' } })).toBe(0);
    } finally {
      await prisma.company.delete({ where: { id: company.id } });
    }
  });

  skipIfNoDb('manual technical stack persists into the account cockpit', async () => {
    const put = await server.inject({
      method: 'PUT',
      url: `/api/crm/companies/${TEST_NORMALIZED}/technical-stack`,
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
      url: `/api/crm/companies/${TEST_NORMALIZED}/technical-stack`,
    });
    expect(state.statusCode).toBe(200);
    expect(state.json().manualStack[0].items[0].name).toBe('Snowflake');

    const cockpit = await server.inject({ method: 'GET', url: `/api/crm/companies/${TEST_NORMALIZED}` });
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
        url: `/api/crm/companies/${TEST_NORMALIZED}/technical-stack/refresh`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.state.companyKey).toBe(TEST_NORMALIZED);
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
        url: `/api/crm/companies/${TEST_NORMALIZED}/technical-stack/refresh`,
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
        url: `/api/crm/companies/${TEST_NORMALIZED}/technical-stack/refresh`,
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
