import { afterAll, beforeAll, describe, expect } from 'vitest';

import { prisma } from '@bidstack/db';
import { AccountDirection, AccountFinancialsIntel, AccountHiringIntel, AccountNewsIntel, RBAC_MATRIX } from '@bidstack/shared';

import { __setAccountIntelEnqueueForTest } from '../queues/account-intel.js';
import { buildServer } from '../server.js';
import { createIsolatedOrg, dropIsolatedOrg, useIsolatedOrgAuth } from '../test-support/isolated-org.js';
import { makeSkipIfNoDb } from '../test-support/skip-if-no-db.js';

// Slice 12: account intelligence read model under /api/v1/companies/:id/intel/*.
// Every claim cites evidence; refresh queues one source and never blocks.

let server: Awaited<ReturnType<typeof buildServer>>;
let dbReachable = false;
let orgId: string | null = null;
let restoreAuth: (() => void) | null = null;
let previousStubRoleHeader: string | undefined;
const queued: Array<{ companyId: string; sources: string[] }> = [];
const DAY = 86_400_000;

beforeAll(async () => {
  previousStubRoleHeader = process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER;
  process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER = 'true';
  __setAccountIntelEnqueueForTest(async (job) => {
    queued.push({ companyId: job.companyId, sources: job.sources });
    return `job-${queued.length}`;
  });
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    return;
  }
  const org = await createIsolatedOrg('company-intel');
  orgId = org.orgId;
  restoreAuth = useIsolatedOrgAuth(org.clerkOrg);
  server = await buildServer();
  await server.ready();
});

afterAll(async () => {
  __setAccountIntelEnqueueForTest(null);
  if (server) await server.close();
  if (restoreAuth) restoreAuth();
  if (orgId) await dropIsolatedOrg(orgId);
  if (dbReachable) await prisma.$disconnect();
  if (previousStubRoleHeader === undefined) delete process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER;
  else process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER = previousStubRoleHeader;
});

const skipIfNoDb = makeSkipIfNoDb(() => dbReachable && !!orgId);

async function seededCompany() {
  const now = Date.now();
  const c = await prisma.company.create({ data: { orgId: orgId!, name: `Intel Co ${now}`, tier: 'key', domain: `intel-co-${now}.example` } });
  for (const [fy, revenue, capex] of [[2024, 1000e6, 80e6], [2025, 1100e6, 120e6]] as const) {
    await prisma.accountFinancialPeriod.create({
      data: {
        orgId: orgId!, companyId: c.id, source: 'esef', entityId: 'LEI', periodType: 'FY', fiscalYear: fy, periodEnd: new Date(`${fy}-12-31`), currency: 'EUR', sourceUrl: `https://filings.xbrl.org/r-${fy}`,
        metrics: { revenue: { value: revenue, concept: 'ifrs-full:Revenue' }, capex: { value: capex, concept: 'ifrs-full:PurchaseOfPropertyPlantAndEquipment' }, _derived: { operatingMargin: 11, netMargin: 8, freeCashFlow: null } },
      },
    });
  }
  for (const [i, title, fn] of [[1, 'Data Engineer, Databricks', 'data'], [2, 'Machine Learning Engineer', 'ml_ai'], [3, 'SAP S/4HANA Finance Lead', 'finance']] as const) {
    await prisma.companyJobPosting.create({
      data: {
        orgId: orgId!, companyId: c.id, source: 'greenhouse', externalId: `gh-${i}`, title, url: `https://boards.greenhouse.io/intelco/jobs/${i}`, city: 'Oslo', country: 'NO', region: 'emea', function: fn, seniority: 'senior',
        skills: [], department: 'Technology', postedAt: new Date(now - i * 5 * DAY), lastSeenAt: new Date(now - DAY), fetchedAt: new Date(now - DAY),
      },
    });
  }
  await prisma.companyPost.create({
    data: { orgId: orgId!, companyId: c.id, source: 'newsroom', externalId: 'p1', url: 'https://intel-co.example/news/ai', title: 'Intel Co launches AI assistant for customers', excerpt: 'A generative AI assistant for service.', kind: 'product', theme: 'data_ai', publishedAt: new Date(now - 7 * DAY), fetchedAt: new Date(now - DAY) },
  });
  await prisma.intelSourceRun.create({ data: { orgId: orgId!, companyId: c.id, source: 'hiring', status: 'ok', lastFetchedAt: new Date(now - DAY), result: { new: 3, updated: 0, skipped: 0, failed: 0 } } });
  return c;
}

describe('company intel routes', () => {
  skipIfNoDb('direction cross-references stored facts and every claim resolves to evidence', async () => {
    const c = await seededCompany();
    const res = await server.inject({ method: 'GET', url: `/api/v1/companies/${c.id}/intel/direction` });
    expect(res.statusCode).toBe(200);
    const body = AccountDirection.parse(res.json());
    expect(body.claims.length).toBeGreaterThan(0);
    const ids = new Set(body.evidence.map((e) => e.id));
    for (const claim of [...body.claims, ...body.investing, ...body.next12]) {
      for (const id of claim.evidenceIds) expect(ids.has(id)).toBe(true);
    }
    for (const e of body.evidence) {
      expect(e.excerpt.length).toBeGreaterThan(0);
      expect(e.fetchedAt).not.toBeNull();
    }
    expect(body.investing.find((t) => t.area === 'capex')).toMatchObject({ amount: 120e6, currency: 'EUR', trendPct: 50 });
    expect(body.bidRelevance[0]?.theme).toBe('data_ai');
    expect(body.sources.find((s) => s.key === 'hiring')).toMatchObject({ status: 'ok', result: { new: 3 } });
    expect(body.sources.find((s) => s.key === 'posts')).toMatchObject({ status: 'never' });
    expect(JSON.stringify(body)).not.toContain('\u2014');
  });

  skipIfNoDb('hiring, financials and news read models come back typed', async () => {
    const c = await seededCompany();
    const hiring = AccountHiringIntel.parse((await server.inject({ method: 'GET', url: `/api/v1/companies/${c.id}/intel/hiring` })).json());
    expect(hiring.summary.openRoles).toBe(3);
    expect(hiring.summary.skills.map((s) => s.skill)).toEqual(expect.arrayContaining(['Databricks', 'SAP S/4HANA']));
    const fin = AccountFinancialsIntel.parse((await server.inject({ method: 'GET', url: `/api/v1/companies/${c.id}/intel/financials` })).json());
    expect(fin.years.map((y) => y.fiscalYear)).toEqual([2024, 2025]);
    expect(fin.years[1]).toMatchObject({ revenue: 1100e6, source: 'ESEF (filings.xbrl.org)' });
    const news = AccountNewsIntel.parse((await server.inject({ method: 'GET', url: `/api/v1/companies/${c.id}/intel/news` })).json());
    expect(news.items[0]).toMatchObject({ origin: 'own', kind: 'product' });
  });

  skipIfNoDb('refresh queues one source with a 202 and records it as queued', async () => {
    const c = await seededCompany();
    const res = await server.inject({ method: 'POST', url: `/api/v1/companies/${c.id}/intel/refresh`, payload: { source: 'posts' } });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toMatchObject({ queued: true, source: 'posts', status: { key: 'posts', status: 'queued' } });
    expect(queued.at(-1)).toEqual({ companyId: c.id, sources: ['posts'] });
    const bad = await server.inject({ method: 'POST', url: `/api/v1/companies/${c.id}/intel/refresh`, payload: { source: 'linkedin' } });
    expect(bad.statusCode).toBe(400);
  });

  skipIfNoDb('RBAC: Read-Only reads but cannot refresh; another org gets 404', async () => {
    const c = await seededCompany();
    expect(RBAC_MATRIX['Read-Only']).toContain('account-intel:read');
    expect(RBAC_MATRIX['Read-Only']).not.toContain('account-intel:write');
    const read = await server.inject({ method: 'GET', url: `/api/v1/companies/${c.id}/intel/hiring`, headers: { 'x-bidstack-e2e-role': 'read-only' } });
    expect(read.statusCode).toBe(200);
    const write = await server.inject({ method: 'POST', url: `/api/v1/companies/${c.id}/intel/refresh`, headers: { 'x-bidstack-e2e-role': 'read-only' }, payload: { source: 'hiring' } });
    expect(write.statusCode).toBe(403);
    const other = await prisma.org.create({ data: { clerkOrg: `org_intel_other_${Date.now()}`, name: 'Other' } });
    const foreign = await prisma.company.create({ data: { orgId: other.id, name: 'Foreign Co' } });
    const miss = await server.inject({ method: 'GET', url: `/api/v1/companies/${foreign.id}/intel/direction` });
    expect(miss.statusCode).toBe(404);
    await prisma.org.delete({ where: { id: other.id } }).catch(() => undefined);
  });
});
