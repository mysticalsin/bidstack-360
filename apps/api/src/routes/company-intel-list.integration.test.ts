import { afterAll, beforeAll, describe, expect } from 'vitest';

import { openImportBatch, prisma, recomputeCompanyIntelSummary } from '@bidstack/db';
import { CompanyIntelSummary } from '@bidstack/shared';

import { __setAccountIntelEnqueueForTest } from '../queues/account-intel.js';
import { buildServer } from '../server.js';
import { createIsolatedOrg, dropIsolatedOrg, useIsolatedOrgAuth } from '../test-support/isolated-org.js';
import { makeSkipIfNoDb } from '../test-support/skip-if-no-db.js';

// Slice 14: the Companies list carries each company's intel summary (revenue,
// headcount growth, open and new roles, funding, signal, direction) with the
// source of every number, filters by the saved views, and a company can be
// refreshed from every public source plus Apollo org data in one request.

let server: Awaited<ReturnType<typeof buildServer>>;
let dbReachable = false;
let orgId: string | null = null;
let restoreAuth: (() => void) | null = null;
let previousStubRoleHeader: string | undefined;
const queued: Array<Record<string, unknown>> = [];
const DAY = 86_400_000;
const ids: Record<'big' | 'hiring' | 'shrinking' | 'empty', string> = { big: '', hiring: '', shrinking: '', empty: '' };
const connections = { publicSources: true, apollo: true };

beforeAll(async () => {
  previousStubRoleHeader = process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER;
  process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER = 'true';
  __setAccountIntelEnqueueForTest(async (job) => {
    queued.push(job as unknown as Record<string, unknown>);
    return `job-${queued.length}`;
  });
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    return;
  }
  const org = await createIsolatedOrg('company-intel-list');
  orgId = org.orgId;
  restoreAuth = useIsolatedOrgAuth(org.clerkOrg);
  server = await buildServer();
  await server.ready();

  const now = Date.now();
  const o = orgId;
  const mk = (name: string) => prisma.company.create({ data: { orgId: o, name: `${name} ${now}`, domain: `${name.toLowerCase()}-${now}.example` } });
  ids.big = (await mk('Bigbank')).id;
  ids.hiring = (await mk('Hireco')).id;
  ids.shrinking = (await mk('Shrinkco')).id;
  ids.empty = (await mk('Emptyco')).id;

  for (const [fy, revenue] of [[2024, 2.1e9], [2025, 2.4e9]] as const) {
    await prisma.accountFinancialPeriod.create({
      data: { orgId: o, companyId: ids.big, source: 'esef', entityId: 'LEI', periodType: 'FY', fiscalYear: fy, periodEnd: new Date(`${fy}-12-31`), currency: 'EUR', sourceUrl: `https://filings.xbrl.org/r-${fy}`, metrics: { revenue: { value: revenue, concept: 'ifrs-full:Revenue' } } },
    });
  }
  await prisma.companyFirmographics.create({
    data: { orgId: o, companyId: ids.hiring, status: 'ok', annualRevenueUsd: 80_000_000n, revenueRange: '50M-100M', employeeCount: 640, headcountGrowth6m: 0.08, provenance: { annualRevenueUsd: { source: 'apollo', fetchedAt: new Date(now - DAY).toISOString() }, headcountGrowth6m: { source: 'apollo', fetchedAt: new Date(now - DAY).toISOString() } }, fetchedAt: new Date(now - DAY) },
  });
  for (let i = 0; i < 7; i++) {
    await prisma.companyJobPosting.create({
      data: { orgId: o, companyId: ids.hiring, source: 'lever', externalId: `lv-${i}`, title: `Data Engineer ${i}`, region: 'emea', function: 'data', seniority: 'senior', skills: ['Python'], postedAt: new Date(now - (i * 3 + 1) * DAY), lastSeenAt: new Date(now - DAY), fetchedAt: new Date(now - DAY) },
    });
  }
  await prisma.companyFirmographics.create({
    data: { orgId: o, companyId: ids.shrinking, status: 'ok', employeeCount: 3000, headcountGrowth6m: -0.07, provenance: { headcountGrowth6m: { source: 'apollo', fetchedAt: new Date(now - DAY).toISOString() } }, fetchedAt: new Date(now - DAY) },
  });
  await prisma.companyPost.create({
    data: { orgId: o, companyId: ids.shrinking, source: 'newsroom', externalId: 'n1', url: 'https://shrinkco.example/news/1', title: 'Shrinkco to cut 400 roles', excerpt: 'Restructuring.', kind: 'layoffs', publishedAt: new Date(now - 10 * DAY), fetchedAt: new Date(now - DAY) },
  });
  for (const id of [ids.big, ids.hiring, ids.shrinking]) await recomputeCompanyIntelSummary(prisma, o, id, { now: new Date(now), connections });
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

type ListItem = { id: string; intel: CompanyIntelSummary | null };
async function list(query = ''): Promise<ListItem[]> {
  const res = await server.inject({ method: 'GET', url: `/api/v1/companies${query}` });
  expect(res.statusCode).toBe(200);
  return (res.json() as { items: ListItem[] }).items;
}

describe('companies list intel', () => {
  skipIfNoDb('every list item carries revenue, headcount growth and new roles with their sources', async () => {
    const items = await list();
    const by = new Map(items.map((i) => [i.id, i.intel]));
    const big = CompanyIntelSummary.parse(by.get(ids.big));
    expect(big.revenue).toMatchObject({ value: 2.4e9, currency: 'EUR', fiscalYear: 2025, source: 'esef', inferred: false });
    expect(big.revenueGrowth).toMatchObject({ inferred: true, fromYear: 2024, toYear: 2025 });

    const hiring = CompanyIntelSummary.parse(by.get(ids.hiring));
    expect(hiring.revenue).toMatchObject({ source: 'apollo', sourceLabel: 'Apollo', fiscalYear: null });
    expect(hiring.headcountGrowth).toMatchObject({ window: '6m', source: 'apollo' });
    expect(hiring.newRoles30d).toMatchObject({ value: 7, source: 'job_boards', sourceLabel: 'Lever' });
    expect(hiring.newRoles30d?.method).toMatch(/hiring proxy/i);

    const shrinking = CompanyIntelSummary.parse(by.get(ids.shrinking));
    expect(shrinking.direction).toMatchObject({ value: 'contracting', inferred: true });
    expect(shrinking.signal).toMatchObject({ kind: 'layoffs' });

    expect(by.get(ids.empty)).toBeNull();
  });

  skipIfNoDb('saved views filter on the server', async () => {
    const pick = (items: ListItem[]) => items.map((i) => i.id).filter((id) => Object.values(ids).includes(id)).sort();
    expect(pick(await list('?view=revenue_over_1b'))).toEqual([ids.big]);
    expect(pick(await list('?view=hiring_fast'))).toEqual([ids.hiring]);
    expect(pick(await list('?view=contracting'))).toEqual([ids.shrinking]);
    expect(pick(await list('?direction=growing'))).toEqual([ids.big, ids.hiring].sort());
    expect((await server.inject({ method: 'GET', url: '/api/v1/companies?view=nope' })).statusCode).toBe(400);
  });

  skipIfNoDb('summary route returns the typed summary; a company with none answers null', async () => {
    const res = await server.inject({ method: 'GET', url: `/api/v1/companies/${ids.hiring}/intel/summary` });
    expect(res.statusCode).toBe(200);
    expect(CompanyIntelSummary.parse(res.json().summary).companyId).toBe(ids.hiring);
    const none = await server.inject({ method: 'GET', url: `/api/v1/companies/${ids.empty}/intel/summary` });
    expect(none.json()).toEqual({ summary: null });
  });

  skipIfNoDb('refresh-all queues one full refresh with force; read-only cannot', async () => {
    const res = await server.inject({ method: 'POST', url: `/api/v1/companies/${ids.empty}/intel/refresh-all` });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toMatchObject({ queued: true });
    expect(queued.at(-1)).toMatchObject({ kind: 'full-refresh', companyId: ids.empty, force: true, batchId: null });
    const ro = await server.inject({ method: 'POST', url: `/api/v1/companies/${ids.empty}/intel/refresh-all`, headers: { 'x-bidstack-e2e-role': 'read-only' } });
    expect(ro.statusCode).toBe(403);
  });

  skipIfNoDb('import batches list progress for this org only', async () => {
    const batchId = await openImportBatch(prisma, { orgId: orgId!, migrationJobId: null, origin: 'csv', companyIds: [ids.big, ids.hiring], createdById: null });
    const res = await server.inject({ method: 'GET', url: '/api/v1/companies/intel-imports' });
    expect(res.statusCode).toBe(200);
    const items = res.json().items as Array<{ id: string; total: number; done: number; status: string }>;
    expect(items.find((b) => b.id === batchId)).toMatchObject({ total: 2, done: 0, status: 'running' });
  });
});
