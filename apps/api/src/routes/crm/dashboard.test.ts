import { afterAll, beforeAll, describe, expect } from 'vitest';

import { prisma } from '@bidstack/db';

import { buildServer } from '../../server.js';
import { makeSkipIfNoDb } from '../../test-support/skip-if-no-db.js';

let server: Awaited<ReturnType<typeof buildServer>>;
let dbReachable = false;

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  server = await buildServer();
  await server.ready();
});

afterAll(async () => {
  if (server) await server.close();
  if (dbReachable) await prisma.$disconnect();
});

const skipIfNoDb = makeSkipIfNoDb(() => dbReachable);

describe('crm dashboard routes', () => {
  skipIfNoDb('GET /api/crm/dashboard returns a snapshot with companies', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/crm/dashboard' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.companies).toEqual(expect.any(Array));
    expect(body.releaseScore).toEqual(expect.any(Object));
    expect(body.generatedAt).toEqual(expect.any(String));
    expect(body.activities.length).toBeLessThanOrEqual(12);
    expect(body.cockpit.risks.length).toBeLessThanOrEqual(6);
    expect(body.cockpit.compliance.length).toBeLessThanOrEqual(6);
    expect(new Set(body.cockpit.risks.map((risk: { title: string }) => risk.title)).size).toBe(
      body.cockpit.risks.length,
    );
  });

  skipIfNoDb(
    'GET /api/crm/dashboard?account= returns snapshot with cockpit when account matches',
    async () => {
      // First fetch the dashboard to get a valid company id
      const dash = await server.inject({ method: 'GET', url: '/api/crm/dashboard' });
      const baseline = dash.json();
      const companies = baseline.companies as Array<{ id: string; name: string }>;
      if (companies.length === 0) {
        console.warn('[skip] no companies seeded');
        return;
      }
      const target =
        companies.find((company) => company.id !== baseline.cockpit.company.id) ?? companies[0]!;

      const res = await server.inject({
        method: 'GET',
        url: `/api/crm/dashboard?account=${target.id}`,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.cockpit).toBeDefined();
      expect(body.cockpit.company.id).toBe(target.id);
      const expectedOpenDeals = body.deals.filter(
        (deal: { companyId: string | null; companyName: string | null; stage: string }) =>
          (deal.companyId === target.id || deal.companyName === target.name) &&
          deal.stage !== 'customer' &&
          deal.stage !== 'closed_won' &&
          deal.stage !== 'closed_lost',
      ).length;
      const openDealsKpi = body.cockpit.kpis.find(
        (kpi: { label: string; value: string }) => kpi.label === 'Open deals',
      );
      expect(openDealsKpi?.value).toBe(String(expectedOpenDeals));
    },
  );

  skipIfNoDb('GET /api/crm/dashboard?account= falls back to normalized name match', async () => {
    const dash = await server.inject({ method: 'GET', url: '/api/crm/dashboard' });
    const companies = dash.json().companies as Array<{ id: string; name: string }>;
    if (companies.length === 0) {
      console.warn('[skip] no companies seeded');
      return;
    }
    const target = companies[0]!;
    const normalized = target.name.toLowerCase().replace(/\s+/g, '-');

    const res = await server.inject({
      method: 'GET',
      url: `/api/crm/dashboard?account=${normalized}`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.cockpit).toBeDefined();
    expect(body.cockpit.company.name).toBe(target.name);
  });

  skipIfNoDb('GET /api/crm/dashboard?account= returns 404 for unknown account', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/api/crm/dashboard?account=unknown-account-should-not-fallback',
    });
    expect(res.statusCode).toBe(404);
  });

  skipIfNoDb('GET /api/crm/release-score returns the score object', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/crm/release-score' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.functional).toEqual(expect.any(Number));
    expect(body.code).toEqual(expect.any(Number));
    expect(body.design).toEqual(expect.any(Number));
    expect(body.infra).toEqual(expect.any(Number));
    expect(body.total).toEqual(expect.any(Number));
    expect(body.passed).toEqual(expect.any(Boolean));
  });
});
