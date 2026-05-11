import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@bidstack/db';

import { buildServer } from '../server.js';

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
  await prisma.dashboardWidget.deleteMany({
    where: { orgId, kind: 'provider_health' },
  });

  server = await buildServer();
  await server.ready();
});

afterAll(async () => {
  if (orgId) {
    await prisma.companyEnrichment.deleteMany({
      where: { orgId, normalizedName: TEST_NORMALIZED },
    });
    await prisma.dashboardWidget.deleteMany({
      where: { orgId, kind: 'provider_health' },
    });
  }
  if (server) await server.close();
  if (dbReachable) await prisma.$disconnect();
});

const skipIfNoDb = (name: string, fn: () => Promise<void> | void) =>
  it(name, async () => {
    if (!dbReachable || !orgId) {
      console.warn(`[skip] ${name} - DATABASE_URL or seed org not reachable`);
      return;
    }
    await fn();
  });

describe('crm routes', () => {
  skipIfNoDb('POST /api/crm/companies/:id/enrich persists an enrichment cache row', async () => {
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
      source: 'enrichment',
    });

    const row = await prisma.companyEnrichment.findUnique({
      where: { orgId_normalizedName: { orgId: orgId!, normalizedName: TEST_NORMALIZED } },
    });
    expect(row?.domain).toBe(TEST_DOMAIN);
    expect(row?.confidenceBps).toBe(7200);
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

  skipIfNoDb('PATCH /api/crm/widgets persists widget layout by kind', async () => {
    const res = await server.inject({
      method: 'PATCH',
      url: '/api/crm/widgets',
      payload: {
        widgets: [
          {
            id: 'provider-health-local',
            kind: 'provider_health',
            title: 'Provider Health',
            x: 2,
            y: 4,
            w: 3,
            h: 2,
            config: { compact: true },
          },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().widgets[0]).toMatchObject({
      kind: 'provider_health',
      x: 2,
      y: 4,
      w: 3,
      h: 2,
    });

    const row = await prisma.dashboardWidget.findUnique({
      where: { orgId_kind: { orgId: orgId!, kind: 'provider_health' } },
    });
    expect(row?.title).toBe('Provider Health');
    expect(row?.config).toMatchObject({ compact: true });
  });

  skipIfNoDb('GET /api/crm/data-quality returns an auditable issue report', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/crm/data-quality' });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.generatedAt).toEqual(expect.any(String));
    expect(Array.isArray(body.issues)).toBe(true);
    expect(body.counts).toEqual(expect.any(Object));
  });

  skipIfNoDb('GET /api/crm/connectors exposes real provider modes', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/crm/connectors' });

    expect(res.statusCode).toBe(200);
    expect(res.json().items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'sec-edgar', kind: 'open_api' }),
        expect.objectContaining({ id: 'tradingview-widgets', kind: 'official_widget' }),
        expect.objectContaining({ id: 'apollo-organizations', kind: 'credentialed_api' }),
      ]),
    );
  });

  skipIfNoDb(
    'GET /api/crm/open-data/signals returns connectors without fabricating data',
    async () => {
      const res = await server.inject({ method: 'GET', url: '/api/crm/open-data/signals' });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        generatedAt: expect.any(String),
        signals: [],
      });
      expect(res.json().connectors.length).toBeGreaterThan(0);
    },
  );
});
