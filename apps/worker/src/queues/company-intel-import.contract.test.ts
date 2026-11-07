// Slice 14 end to end, against Postgres: a CSV import of three companies
// queues one intel refresh per new company, the refresh reads public job
// boards and Apollo ORGANIZATION data from fixtures, and the summary the
// Companies list reads shows revenue, headcount growth and new roles in the
// last 30 days, each with its source. Retries do not queue twice.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma, readCompanyIntelSummaries, readImportBatches } from '@bidstack/db';
import type { MigrationJobPayload } from '@bidstack/shared';

import type { IntelFetch } from '../lib/account-intel/http.js';
import { fullRefreshDeps, runCompanyFullRefresh, type FullRefreshQueueJob } from '../lib/company-intel/full-refresh.js';
import { processMigrationChunk } from './migration.js';

const stamp = Date.now();
const NOW = new Date();
const day = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();
const UA = 'PoloAccountIntel/1.0 (+mailto:intel@polo.example)';

const COMPANIES = [
  { name: `Fjord Analytics ${stamp}`, domain: `fjord-${stamp}.example`, board: `fjord${stamp}` },
  { name: `Harbor Logistics ${stamp}`, domain: `harbor-${stamp}.example`, board: `harbor${stamp}` },
  { name: `Lumen Health ${stamp}`, domain: `lumen-${stamp}.example`, board: `lumen${stamp}` },
];

function greenhouse(board: string): string {
  const jobs = [3, 8, 14, 21, 40, 75].map((d, i) => ({
    id: Number(`${i + 1}${stamp % 100000}`),
    title: ['Senior Data Engineer', 'Cloud Platform Engineer', 'Security Analyst', 'Account Executive', 'Product Manager', 'Finance Controller'][i],
    absolute_url: `https://job-boards.greenhouse.io/${board}/jobs/${i + 1}`,
    first_published: day(d),
    updated_at: day(1),
    location: { name: 'Oslo, Norway' },
    departments: [{ name: 'Technology' }],
  }));
  return JSON.stringify({ jobs, meta: { total: jobs.length } });
}

function apolloOrg(domain: string) {
  return {
    organization: {
      id: `ap-${domain}`,
      name: domain,
      annual_revenue: 420_000_000,
      annual_revenue_printed: '420M',
      estimated_num_employees: 2100,
      organization_headcount_six_month_growth: 0.06,
      organization_headcount_twelve_month_growth: 0.12,
      departmental_head_count: { engineering: 600, sales: 250 },
      total_funding: 90_000_000,
      latest_funding_stage: 'Series B',
      latest_funding_round_date: '2025-03-01',
      founded_year: 2009,
      industry: 'computer software',
      technology_names: ['Snowflake'],
      primary_phone: { number: '+47 21 00 00 00' },
      phone: '+47 21 00 00 00',
      email: `info@${domain}`,
    },
  };
}

const calls: string[] = [];
const routes = new Map<string, string>();
for (const c of COMPANIES) {
  routes.set(`https://www.${c.domain}/robots.txt`, 'User-agent: *\nAllow: /\n');
  routes.set(`https://www.${c.domain}/careers`, `<html><body><a href="https://boards.greenhouse.io/${c.board}">Open roles</a></body></html>`);
}
routes.set('https://boards-api.greenhouse.io/robots.txt', 'User-agent: *\nAllow: /\n');

const intelFetch: IntelFetch = async (url) => {
  calls.push(url);
  const gh = /^https:\/\/boards-api\.greenhouse\.io\/v1\/boards\/([^/]+)\/jobs/.exec(url);
  if (gh) return { ok: true, status: 200, text: async () => greenhouse(gh[1]!) };
  const body = routes.get(url);
  if (body !== undefined) return { ok: true, status: 200, text: async () => body };
  return { ok: false, status: 404, text: async () => '' };
};

const apolloFetch = async (url: string): Promise<Response> => {
  calls.push(url);
  const m = /organizations\/enrich\?domain=([^&]+)/.exec(url);
  if (!m) return new Response('{}', { status: 404 });
  return new Response(JSON.stringify(apolloOrg(decodeURIComponent(m[1]!))), { status: 200, headers: { 'content-type': 'application/json' } });
};

const env = { ACCOUNT_INTEL_USER_AGENT: UA, APOLLO_API_KEY: 'test-key-not-real', ACCOUNT_INTEL_MIN_GAP_MS: '250' };

let orgId = '';
let userId = '';
let migrationJobId = '';
const queued: FullRefreshQueueJob[] = [];

function payload(): MigrationJobPayload {
  return {
    migrationJobId,
    orgId,
    userId,
    source: 'CSV',
    entityType: 'companies',
    chunkOffset: 0,
    chunkSize: 100,
    totalRows: 3,
    redisKey: `test:${stamp}`,
    mappings: { Name: 'company.name', Domain: 'company.domain', Country: 'company.countryCode' },
    dedupStrategy: 'skip',
  } as MigrationJobPayload;
}

const chunkDeps = {
  readRows: async () => JSON.stringify(COMPANIES.map((c) => ({ Name: c.name, Domain: c.domain, Country: 'NO' }))),
  enqueueChunk: async () => undefined,
  enqueueIntel: async (jobs: Array<{ data: FullRefreshQueueJob; jobId: string }>) => {
    for (const j of jobs) if (!queued.some((q) => q.companyId === j.data.companyId)) queued.push(j.data);
  },
  env: {},
};

beforeAll(async () => {
  orgId = (await prisma.org.create({ data: { name: 'S14 import', clerkOrg: `org_s14_${stamp}` } })).id;
  userId = (await prisma.user.create({ data: { orgId, clerkUser: `user_s14_${stamp}`, email: `s14.${stamp}@polo.example`, name: 'Import Runner' } })).id;
  migrationJobId = (await prisma.migrationJob.create({ data: { orgId, userId, source: 'CSV', status: 'RUNNING', totalRows: 3 } })).id;
});

afterAll(async () => {
  if (orgId) await prisma.org.delete({ where: { id: orgId } }).catch(() => undefined);
});

describe('company import queues intel enrichment end to end', () => {
  it('queues one refresh per new company and opens a progress batch', async () => {
    const log = { info: () => undefined, warn: () => undefined } as never;
    await processMigrationChunk(payload(), chunkDeps, log);
    expect(queued).toHaveLength(3);
    const [batch] = await readImportBatches(prisma, orgId);
    expect(batch).toMatchObject({ origin: 'csv', total: 3, done: 0, status: 'running', migrationJobId });
    expect(queued.every((q) => q.batchId === batch!.id && q.kind === 'full-refresh')).toBe(true);
  });

  it('is idempotent: a retried chunk adds no companies and no new batch', async () => {
    const log = { info: () => undefined, warn: () => undefined } as never;
    await processMigrationChunk(payload(), chunkDeps, log);
    const batches = await readImportBatches(prisma, orgId);
    expect(batches).toHaveLength(1);
    expect(batches[0]!.total).toBe(3);
    expect(await prisma.company.count({ where: { orgId } })).toBe(3);
  });

  it('enriches each company from public boards and Apollo org data, with sources', async () => {
    const deps = fullRefreshDeps({ env, intelFetch, apolloFetch, financials: async () => ({ status: 'not_configured', periods: 0, detail: null }), now: () => NOW, sleep: async () => undefined });
    for (const job of queued) await runCompanyFullRefresh(job, deps);

    const ids = queued.map((q) => q.companyId);
    const summaries = await readCompanyIntelSummaries(prisma, orgId, ids);
    expect(summaries.size).toBe(3);
    for (const id of ids) {
      const s = summaries.get(id)!;
      expect(s.revenue).toMatchObject({ value: 420_000_000, source: 'apollo', sourceLabel: 'Apollo' });
      expect(s.revenue?.asOf).toBeTruthy();
      expect(s.headcountGrowth).toMatchObject({ window: '6m', source: 'apollo' });
      expect(s.headcountGrowth?.value).toBeCloseTo(6);
      expect(s.newRoles30d).toMatchObject({ value: 4, source: 'job_boards', sourceLabel: 'Greenhouse' });
      expect(s.funding).toMatchObject({ value: 90_000_000, latestRound: 'Series B' });
      expect(s.direction?.value).toBe('growing');
    }

    const [batch] = await readImportBatches(prisma, orgId);
    expect(batch).toMatchObject({ status: 'complete', done: 3, failed: 0 });
    expect(batch!.summary).toMatchObject({ withRevenue: 3, withHeadcountGrowth: 3, withNewRoles30d: 3 });
  });

  it('never calls a people or contact endpoint and stores no email or phone', async () => {
    expect(calls.some((u) => u.includes('/organizations/enrich'))).toBe(true);
    expect(calls.join('\n')).not.toMatch(/people|contacts|person|mixed_|\/match|email|phone/i);
    const rows = await prisma.companyFirmographics.findMany({ where: { orgId } });
    expect(rows).toHaveLength(3);
    const stored = JSON.stringify(rows, (_k, v) => (typeof v === 'bigint' ? Number(v) : v));
    expect(stored).not.toMatch(/\+47|info@|phone|email/i);
    const summaries = await prisma.companyIntelSummary.findMany({ where: { orgId } });
    expect(JSON.stringify(summaries)).not.toMatch(/\+47|info@/);
  });
});
