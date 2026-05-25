import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@bidstack/db';

import { buildServer } from '../../server.js';

let server: Awaited<ReturnType<typeof buildServer>>;
let dbReachable = false;
let orgId: string | null = null;

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
  const org = await prisma.org.findUnique({ where: { clerkOrg: 'org_seed_mantu' } });
  orgId = org?.id ?? null;
  if (!orgId) return;

  await prisma.companyEnrichment.deleteMany({
    where: { orgId, normalizedName: TEST_NORMALIZED },
  });

  server = await buildServer();
  await server.ready();
});

afterAll(async () => {
  if (orgId) {
    await prisma.companyEnrichment.deleteMany({
      where: { orgId, normalizedName: TEST_NORMALIZED },
    });
  }
  if (server) await server.close();
  if (dbReachable) await prisma.$disconnect();
});

const skipIfNoDb = (name: string, fn: () => Promise<void> | void) =>
  it(name, async () => {
    if (!dbReachable || !orgId) {
      throw new Error(`[skip] ${name} — DATABASE_URL or seed org not reachable`);
    }
    await fn();
  });

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
});
