// Account enrichment routes: RBAC (companies:read, refresh needs companies:write),
// org + scope isolation (404), audit, and the response contract.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { prisma } from '@bidstack/db';

import { invalidateAccessScope } from '../lib/access-scope.js';
import { clearRbacDecisionCacheForTest } from '../lib/rbac-decision-cache.js';
import { __setAccountEnrichmentEnqueueForTest, accountEnrichmentJobId } from '../queues/account-enrichment.js';
import { buildServer } from '../server.js';
import { createIsolatedOrg, dropIsolatedOrg, useIsolatedOrgAuth } from '../test-support/isolated-org.js';

const TAG = `enr${Date.now()}`;
let server: FastifyInstance;
let orgA = { orgId: '', clerkOrg: '' };
let orgB = { orgId: '', clerkOrg: '' };
let restoreAuth: (() => void) | null = null;
let prevRoleHeader: string | undefined;
let adminId = '';
const c: Record<string, string> = {};
const queued: unknown[] = [];
const FETCHED = new Date('2026-10-31T15:00:00.000Z');

function call(method: 'GET' | 'POST', url: string, opts: { payload?: unknown; role?: string } = {}) {
  return server.inject({
    method,
    url: `/api/v1${url}`,
    ...(opts.payload !== undefined ? { payload: opts.payload as object } : {}),
    headers: opts.role ? { 'x-bidstack-e2e-role': opts.role } : {},
  });
}

const project = (id: string, confidence: 'high' | 'medium' | 'low') => ({
  id,
  kind: id.split(':')[0],
  name: `Project ${id}`,
  rationale: 'Rule rationale.',
  confidence,
  region: 'EMEA',
  postingCount: 12,
  seniorCount: 3,
  skills: ['Snowflake'],
  evidence: [{ postingId: 'p1', title: 'Snowflake Architect', url: 'https://jobs.example/1', region: 'EMEA', seniority: 'principal', postedAt: null, source: 'apollo' }],
  method: 'rules',
});

beforeAll(async () => {
  prevRoleHeader = process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER;
  process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER = 'true';
  orgA = await createIsolatedOrg('enr-a');
  orgB = await createIsolatedOrg('enr-b');
  restoreAuth = useIsolatedOrgAuth(orgA.clerkOrg);
  __setAccountEnrichmentEnqueueForTest(async (j) => (queued.push(j), `job-${queued.length}`));
  adminId = (await prisma.user.findFirstOrThrow({ where: { orgId: orgA.orgId }, orderBy: { createdAt: 'asc' } })).id;
  const mk = async (k: string, data: Record<string, unknown>, orgId = orgA.orgId) =>
    (c[k] = (await prisma.company.create({ data: { orgId, ...data } as never })).id);
  await mk('fr', { name: `${TAG} Acme France`, countryCode: 'FR', domain: 'acme.test' });
  await mk('de', { name: `${TAG} Acme Germany`, countryCode: 'DE' });
  await mk('bare', { name: `${TAG} Never enriched`, countryCode: 'FR' });
  await mk('b', { name: `${TAG} Other org`, countryCode: 'FR' }, orgB.orgId);
  const firmo = (companyId: string, orgId: string, projects: unknown[]) =>
    prisma.companyFirmographics.create({
      data: {
        orgId,
        companyId,
        status: 'ok',
        annualRevenueUsd: 125_000_000n,
        employeeCount: 1200,
        employeeRange: '1,001-5,000',
        headcountGrowth12m: 0.11,
        industry: 'software',
        industries: ['software'],
        locations: [{ city: 'Paris', state: null, country: 'France', kind: 'hq' }],
        techStack: ['Snowflake'],
        departmentHeadcount: { engineering: 300 },
        providerIds: { apollo: 'ap-1' },
        provenance: { employeeCount: { source: 'apollo', fetchedAt: FETCHED.toISOString() }, employeeRange: { source: 'seamless', fetchedAt: FETCHED.toISOString() } },
        providerStatus: { apollo: { status: 'ok', credits: 2, at: FETCHED.toISOString() }, seamless: { status: 'ok', credits: 1, at: FETCHED.toISOString(), pendingRequestId: 'hidden' } },
        hiring: { total: 2, byFunction: [{ key: 'data', count: 2 }], bySeniority: [], byRegion: [{ key: 'EMEA', count: 2 }], topSkills: [], clusters: [] },
        projects: projects as never,
        fetchedAt: FETCHED,
        expiresAt: new Date('2099-01-01T00:00:00Z'),
      },
    });
  await firmo(c.fr!, orgA.orgId, [project('data_platform:EMEA', 'high'), project('security:EMEA', 'low')]);
  await firmo(c.de!, orgA.orgId, [project('erp:EMEA', 'medium')]);
  await firmo(c.b!, orgB.orgId, [project('crm:AMER', 'high')]);
  const post = (externalId: string, title: string, fn: string, region: string, companyId = c.fr!) =>
    prisma.companyJobPosting.create({
      data: { orgId: orgA.orgId, companyId, source: 'apollo', externalId, title, url: `https://jobs.example/${externalId}`, country: 'France', region, function: fn, seniority: 'mid', skills: [], fetchedAt: FETCHED, postedAt: FETCHED },
    });
  await post('j1', 'Data Engineer', 'data', 'EMEA');
  await post('j2', 'Account Executive', 'sales', 'AMER');
  await prisma.enrichmentCreditUsage.createMany({
    data: [
      { orgId: orgA.orgId, provider: 'apollo', operation: 'organizations.enrich', credits: 3, at: new Date() },
      { orgId: orgA.orgId, provider: 'seamless', operation: 'companies.research', credits: 1, at: new Date() },
      { orgId: orgB.orgId, provider: 'apollo', operation: 'organizations.enrich', credits: 50, at: new Date() },
    ],
  });
  server = await buildServer();
  await server.ready();
});

afterAll(async () => {
  __setAccountEnrichmentEnqueueForTest(null);
  await server?.close();
  restoreAuth?.();
  if (prevRoleHeader === undefined) delete process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER;
  else process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER = prevRoleHeader;
  invalidateAccessScope(orgA.orgId);
  if (orgA.orgId) await dropIsolatedOrg(orgA.orgId);
  if (orgB.orgId) await dropIsolatedOrg(orgB.orgId);
});

async function withScope(userId: string, countries: string[], fn: () => Promise<void>) {
  const group = await prisma.userGroup.create({ data: { orgId: orgA.orgId, name: `${TAG}-${countries.join('')}`, scopeCountries: countries } });
  await prisma.userGroupMember.create({ data: { orgId: orgA.orgId, groupId: group.id, userId } });
  invalidateAccessScope(orgA.orgId, userId);
  try {
    await fn();
  } finally {
    await prisma.userGroupMember.deleteMany({ where: { groupId: group.id } });
    await prisma.userGroup.delete({ where: { id: group.id } });
    invalidateAccessScope(orgA.orgId, userId);
  }
}

describe('GET /companies/:id/enrichment', () => {
  it('returns firmographics with provenance and provider status (no pending ids), and audits', async () => {
    const res = await call('GET', `/companies/${c.fr}/enrichment`);
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({
      companyId: c.fr,
      status: 'ok',
      annualRevenueUsd: 125000000,
      employeeCount: 1200,
      headcountGrowth12m: 0.11,
      techStack: ['Snowflake'],
      departmentHeadcount: { engineering: 300 },
      openJobs: 2,
      stale: false,
      provenance: { employeeCount: { source: 'apollo' }, employeeRange: { source: 'seamless' } },
      providers: { apollo: { status: 'ok', credits: 2 }, seamless: { status: 'ok', credits: 1 } },
    });
    expect(JSON.stringify(body)).not.toContain('hidden');
    const audit = await prisma.auditLog.findFirst({ where: { orgId: orgA.orgId, action: 'enrichment.view', targetId: c.fr }, orderBy: { at: 'desc' } });
    expect(audit).toMatchObject({ targetType: 'company', userId: adminId });
  });

  it('a never-enriched company answers not_enriched and stale', async () => {
    const res = await call('GET', `/companies/${c.bare}/enrichment`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'not_enriched', employeeCount: null, industries: [], openJobs: 0, stale: true, fetchedAt: null });
  });

  it('Read-Only (companies:read) can read', async () => {
    clearRbacDecisionCacheForTest();
    expect((await call('GET', `/companies/${c.fr}/enrichment`, { role: 'read-only' })).statusCode).toBe(200);
  });

  it('another org gets 404, and out-of-scope gets 404', async () => {
    expect((await call('GET', `/companies/${c.b}/enrichment`)).statusCode).toBe(404);
    expect((await call('GET', `/companies/${c.b}/enrichment/projects`)).statusCode).toBe(404);
    expect((await call('GET', `/companies/${c.b}/enrichment/hiring`)).statusCode).toBe(404);
    await withScope(adminId, ['DE'], async () => {
      expect((await call('GET', `/companies/${c.fr}/enrichment`)).statusCode).toBe(404);
      expect((await call('GET', `/companies/${c.de}/enrichment`)).statusCode).toBe(200);
      expect((await call('POST', `/companies/${c.fr}/enrichment/refresh`, { payload: {} })).statusCode).toBe(404);
    });
  });
});

describe('GET /companies/:id/enrichment/hiring', () => {
  it('returns the breakdown and filtered postings with links', async () => {
    const all = (await call('GET', `/companies/${c.fr}/enrichment/hiring`)).json();
    expect(all.hiring).toMatchObject({ total: 2, byRegion: [{ key: 'EMEA', count: 2 }] });
    expect(all.postingsTotal).toBe(2);
    const data = await call('GET', `/companies/${c.fr}/enrichment/hiring?function=data`);
    expect(data.statusCode, data.body).toBe(200);
    expect(data.json().postings).toEqual([
      expect.objectContaining({ title: 'Data Engineer', url: 'https://jobs.example/j1', function: 'data', region: 'EMEA', source: 'apollo' }),
    ]);
    expect((await call('GET', `/companies/${c.fr}/enrichment/hiring?region=AMER`)).json().postingsTotal).toBe(1);
    expect((await call('GET', `/companies/${c.fr}/enrichment/hiring?function=nope`)).statusCode).toBe(400);
  });
});

describe('GET /companies/:id/enrichment/projects', () => {
  it('lists potential projects with evidence, filterable by confidence', async () => {
    const res = await call('GET', `/companies/${c.fr}/enrichment/projects`);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().projects.map((p: { id: string }) => p.id)).toEqual(['data_platform:EMEA', 'security:EMEA']);
    expect(res.json().projects[0].evidence[0].url).toBe('https://jobs.example/1');
    const high = (await call('GET', `/companies/${c.fr}/enrichment/projects?minConfidence=medium`)).json();
    expect(high.projects.map((p: { id: string }) => p.id)).toEqual(['data_platform:EMEA']);
  });
});

describe('POST /companies/:id/enrichment/refresh', () => {
  it('queues a job (202) and audits; Read-Only gets 403', async () => {
    queued.length = 0;
    const res = await call('POST', `/companies/${c.fr}/enrichment/refresh`, { payload: { force: true } });
    expect(res.statusCode, res.body).toBe(202);
    expect(res.json()).toMatchObject({ queued: true, jobId: 'job-1', status: 'ok' });
    expect(queued).toEqual([{ kind: 'enrich', orgId: orgA.orgId, companyId: c.fr, force: true, requestedById: adminId }]);
    const audit = await prisma.auditLog.findFirst({ where: { orgId: orgA.orgId, action: 'enrichment.refresh', targetId: c.fr } });
    expect(audit?.diff).toMatchObject({ force: true, queued: true });
    expect((await call('POST', `/companies/${c.bare}/enrichment/refresh`)).json()).toMatchObject({ queued: true, status: 'not_enriched' });
    clearRbacDecisionCacheForTest();
    expect((await call('POST', `/companies/${c.fr}/enrichment/refresh`, { payload: {}, role: 'read-only' })).statusCode).toBe(403);
  });

  it('job ids collapse double clicks within a minute', () => {
    const job = { kind: 'enrich' as const, orgId: 'o', companyId: 'c' };
    expect(accountEnrichmentJobId(job, 120_000)).toBe(accountEnrichmentJobId(job, 179_999));
    expect(accountEnrichmentJobId(job, 120_000)).not.toBe(accountEnrichmentJobId(job, 180_000));
  });
});

describe('GET /enrichment/signals (watchdog)', () => {
  it('feeds medium+ potential projects for in-scope companies of the org only', async () => {
    const res = await call('GET', '/enrichment/signals');
    expect(res.statusCode, res.body).toBe(200);
    const items = res.json().items as Array<Record<string, unknown>>;
    expect(items.map((i) => [i.companyId, i.projectId, i.confidence])).toEqual([
      [c.fr, 'data_platform:EMEA', 'high'],
      [c.de, 'erp:EMEA', 'medium'],
    ]);
    expect(items[0]).toMatchObject({ kind: 'enrichment.potential_project', companyName: `${TAG} Acme France`, evidenceUrls: ['https://jobs.example/1'] });
    const low = (await call('GET', '/enrichment/signals?minConfidence=low')).json().items;
    expect(low).toHaveLength(3);
    await withScope(adminId, ['DE'], async () => {
      const scoped = (await call('GET', '/enrichment/signals')).json().items as Array<{ companyId: string }>;
      expect(scoped.map((i) => i.companyId)).toEqual([c.de]);
    });
  });
});

describe('GET /enrichment/usage', () => {
  it('reports this month per provider for the caller org against the budget', async () => {
    const res = await call('GET', '/enrichment/usage');
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({
      ttlDays: 7,
      providers: [
        { provider: 'apollo', used: 3, budget: 200, remaining: 197 },
        { provider: 'seamless', used: 1, budget: 200, remaining: 199 },
      ],
    });
    expect(res.json().month).toMatch(/^\d{4}-\d{2}$/);
  });
});
