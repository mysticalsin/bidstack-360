import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@bidstack/db';

import {
  creditsUsedThisMonth,
  type EnrichmentDeps,
  enrichmentConfigFromEnv,
  mergeFields,
  monthStart,
  reserveCredits,
  runAccountEnrichment,
} from './job.js';
import {
  createApolloProvider,
  type EnrichmentInput,
  type EnrichmentProvider,
  type EnrichmentProviderId,
  type ProviderContext,
  type ProviderResult,
} from './providers.js';

const stamp = Date.now();
let orgA = '';
let orgB = '';
let acme = '';
let beta = '';
let nodomain = '';
const NOW = new Date('2026-10-31T15:00:00Z');

type Script = (input: EnrichmentInput, ctx: ProviderContext) => Promise<ProviderResult>;
function fake(id: EnrichmentProviderId, script: Script): EnrichmentProvider & { calls: EnrichmentInput[] } {
  const calls: EnrichmentInput[] = [];
  return { id, calls, configured: () => true, enrich: async (input, ctx) => (calls.push(input), script(input, ctx)) };
}

const apolloOk = (extra: Partial<ProviderResult> = {}): Script => async (_i, ctx) => {
  await ctx.reserve('organizations.enrich', 1);
  const postings = Array.from({ length: 6 }, (_, i) => ({
    externalId: `ap-j${i}`,
    title: i === 0 ? 'Snowflake Architect' : 'Data Engineer',
    url: `https://jobs.acme.test/${i}`,
    city: 'London',
    state: null,
    country: 'United Kingdom',
    postedAt: '2026-10-25T00:00:00Z',
    lastSeenAt: '2026-10-30T00:00:00Z',
  }));
  if (ctx.maxJobPages > 0) await ctx.reserve('organizations.job_postings', 1);
  return {
    provider: 'apollo',
    status: 'ok',
    fields: { annualRevenueUsd: 125_000_000, employeeCount: 1200, headcountGrowth12m: 0.11, industry: 'software', locations: [{ city: 'Paris', state: null, country: 'France', kind: 'hq' }] },
    jobPostings: ctx.maxJobPages > 0 ? postings : null,
    providerCompanyId: 'ap-org-1',
    creditsUsed: ctx.maxJobPages > 0 ? 2 : 1,
    ...extra,
  };
};
const seamlessOk: Script = async (_i, ctx) => {
  await ctx.reserve('companies.research', 1);
  return {
    provider: 'seamless',
    status: 'ok',
    fields: { employeeCount: 1150, techStack: ['Snowflake', 'HubSpot'], employeeRange: '1,001-5,000', industry: 'Software' },
    jobPostings: null,
    providerCompanyId: 'sm-1',
    creditsUsed: 1,
  };
};

function deps(providers: EnrichmentProvider[], over: Partial<EnrichmentDeps['config']> = {}, now = NOW): EnrichmentDeps {
  return {
    providers,
    config: { ttlDays: 7, monthlyBudget: { apollo: 100, seamless: 100 }, maxJobPages: 2, ...over },
    now: () => now,
    projectLlm: async () => null,
  };
}

beforeAll(async () => {
  orgA = (await prisma.org.create({ data: { name: 'ENR A', clerkOrg: `org_enr_a_${stamp}` } })).id;
  orgB = (await prisma.org.create({ data: { name: 'ENR B', clerkOrg: `org_enr_b_${stamp}` } })).id;
  acme = (await prisma.company.create({ data: { orgId: orgA, name: `Acme ${stamp}`, domain: 'acme.test' } })).id;
  beta = (await prisma.company.create({ data: { orgId: orgA, name: `Beta ${stamp}`, website: 'https://www.beta.test' } })).id;
  nodomain = (await prisma.company.create({ data: { orgId: orgA, name: `Nodomain ${stamp}` } })).id;
});

afterAll(async () => {
  for (const id of [orgA, orgB]) if (id) await prisma.org.delete({ where: { id } }).catch(() => undefined);
});

beforeEach(async () => {
  await prisma.enrichmentCreditUsage.deleteMany({ where: { orgId: { in: [orgA, orgB] } } });
  await prisma.companyJobPosting.deleteMany({ where: { orgId: { in: [orgA, orgB] } } });
  await prisma.companyFirmographics.deleteMany({ where: { orgId: { in: [orgA, orgB] } } });
});

describe('config', () => {
  it('defaults to a 7 day TTL, 200 credits per provider and 2 job pages', () => {
    expect(enrichmentConfigFromEnv({})).toEqual({ ttlDays: 7, monthlyBudget: { apollo: 200, seamless: 200 }, maxJobPages: 2 });
    expect(
      enrichmentConfigFromEnv({ ENRICHMENT_TTL_DAYS: '14', ENRICHMENT_MONTHLY_CREDIT_BUDGET: '50', SEAMLESS_MONTHLY_CREDIT_BUDGET: '10', ENRICHMENT_MAX_JOB_PAGES: 'x' }),
    ).toEqual({ ttlDays: 14, monthlyBudget: { apollo: 50, seamless: 10 }, maxJobPages: 2 });
  });
});

describe('mergeFields', () => {
  it('first provider wins per field and keeps older values the run did not return', () => {
    const out = mergeFields(
      [
        { provider: 'apollo', status: 'ok', fields: { employeeCount: 10 }, jobPostings: null, creditsUsed: 1 },
        { provider: 'seamless', status: 'ok', fields: { employeeCount: 9, techStack: ['dbt'] }, jobPostings: null, creditsUsed: 1 },
      ],
      { values: { industry: 'old' }, provenance: { industry: { source: 'seamless', fetchedAt: '2026-01-01T00:00:00.000Z' } } },
      '2026-10-31T00:00:00.000Z',
    );
    expect(out.values).toEqual({ industry: 'old', employeeCount: 10, techStack: ['dbt'] });
    expect(out.provenance).toEqual({
      industry: { source: 'seamless', fetchedAt: '2026-01-01T00:00:00.000Z' },
      employeeCount: { source: 'apollo', fetchedAt: '2026-10-31T00:00:00.000Z' },
      techStack: { source: 'seamless', fetchedAt: '2026-10-31T00:00:00.000Z' },
    });
  });
});

describe('credit budget', () => {
  it('writes the ledger before the call and refuses past the monthly budget', async () => {
    const args = { orgId: orgA, provider: 'apollo' as const, operation: 'organizations.enrich', companyId: acme, budget: 3, now: NOW };
    expect(await reserveCredits({ ...args, credits: 2 })).toBe(true);
    expect(await reserveCredits({ ...args, credits: 2 })).toBe(false);
    expect(await reserveCredits({ ...args, credits: 1 })).toBe(true);
    expect(await creditsUsedThisMonth(orgA, 'apollo', NOW)).toBe(3);
    // Per provider and per org.
    expect(await reserveCredits({ ...args, provider: 'seamless', credits: 3 })).toBe(true);
    expect(await reserveCredits({ ...args, orgId: orgB, credits: 3 })).toBe(true);
    // A new month starts fresh.
    expect(await reserveCredits({ ...args, credits: 3, now: new Date('2026-11-01T00:00:01Z') })).toBe(true);
    expect(monthStart(NOW).toISOString()).toBe('2026-10-01T00:00:00.000Z');
  });

  it('is safe under concurrent reservations', async () => {
    const args = { orgId: orgA, provider: 'apollo' as const, operation: 'x', companyId: acme, budget: 5, now: NOW, credits: 1 };
    const res = await Promise.all(Array.from({ length: 12 }, () => reserveCredits(args)));
    expect(res.filter(Boolean)).toHaveLength(5);
    expect(await creditsUsedThisMonth(orgA, 'apollo', NOW)).toBe(5);
  });
});

describe('runAccountEnrichment', () => {
  it('merges Apollo then Seamless with provenance, stores postings, hiring and projects, and caches for the TTL', async () => {
    const apollo = fake('apollo', apolloOk());
    const seamless = fake('seamless', seamlessOk);
    const res = await runAccountEnrichment({ orgId: orgA, companyId: acme, requestedById: null }, deps([apollo, seamless]));
    expect(res).toMatchObject({ outcome: 'refreshed', status: 'ok', credits: 3, postings: 6 });
    expect(apollo.calls[0]).toEqual({ name: `Acme ${stamp}`, domain: 'acme.test', pendingRequestId: null });
    const row = await prisma.companyFirmographics.findUniqueOrThrow({ where: { companyId: acme } });
    expect(row).toMatchObject({
      orgId: orgA,
      status: 'ok',
      employeeCount: 1200,
      employeeRange: '1,001-5,000',
      industry: 'software',
      techStack: ['Snowflake', 'HubSpot'],
      headcountGrowth12m: 0.11,
      providerIds: { apollo: 'ap-org-1', seamless: 'sm-1' },
    });
    expect(row.annualRevenueUsd).toBe(125_000_000n);
    const at = NOW.toISOString();
    expect(row.provenance).toMatchObject({
      employeeCount: { source: 'apollo', fetchedAt: at },
      techStack: { source: 'seamless', fetchedAt: at },
      employeeRange: { source: 'seamless', fetchedAt: at },
    });
    expect(row.expiresAt?.toISOString()).toBe('2026-11-07T15:00:00.000Z');
    expect(row.providerStatus).toMatchObject({ apollo: { status: 'ok', credits: 2, at }, seamless: { status: 'ok', credits: 1 } });
    expect(row.hiring).toMatchObject({ total: 6, byFunction: [{ key: 'data', count: 6 }], byRegion: [{ key: 'EMEA', count: 6 }] });
    const projects = row.projects as Array<Record<string, unknown>>;
    expect(projects[0]).toMatchObject({ id: 'data_platform:EMEA', name: 'Data platform migration to Snowflake in EMEA', confidence: 'medium' });
    const ledger = await prisma.enrichmentCreditUsage.findMany({ where: { orgId: orgA }, orderBy: { operation: 'asc' }, take: 10 });
    expect(ledger.map((l) => [l.provider, l.operation, l.credits, l.companyId])).toEqual([
      ['seamless', 'companies.research', 1, acme],
      ['apollo', 'organizations.enrich', 1, acme],
      ['apollo', 'organizations.job_postings', 1, acme],
    ]);
    const postings = await prisma.companyJobPosting.findMany({ where: { companyId: acme }, take: 10 });
    expect(postings).toHaveLength(6);
    expect(postings.find((p) => p.externalId === 'ap-j0')).toMatchObject({ function: 'data', seniority: 'principal', region: 'EMEA', skills: ['Snowflake'] });

    // Inside the TTL: no provider call, no credits.
    const again = await runAccountEnrichment({ orgId: orgA, companyId: acme }, deps([apollo, seamless], {}, new Date('2026-11-03T00:00:00Z')));
    expect(again).toEqual({ outcome: 'skipped_fresh', status: 'ok' });
    expect(apollo.calls).toHaveLength(1);
    // force bypasses the cache (new TTL ends Nov 10); after that it refreshes too.
    await runAccountEnrichment({ orgId: orgA, companyId: acme, force: true }, deps([apollo, seamless], {}, new Date('2026-11-03T00:00:00Z')));
    await runAccountEnrichment({ orgId: orgA, companyId: acme }, deps([apollo, seamless], {}, new Date('2026-11-11T00:00:00Z')));
    expect(apollo.calls).toHaveLength(3);
  });

  it('skips Seamless when Apollo filled every core field', async () => {
    const apollo = fake('apollo', apolloOk({ fields: { annualRevenueUsd: 1, employeeCount: 2, industry: 'x', locations: [{ city: null, state: null, country: 'France', kind: 'hq' }], techStack: ['AWS'] } }));
    const seamless = fake('seamless', seamlessOk);
    const res = await runAccountEnrichment({ orgId: orgA, companyId: acme }, deps([apollo, seamless]));
    expect(res.status).toBe('ok');
    expect(seamless.calls).toHaveLength(0);
  });

  it('replaces closed postings and keeps them when the postings call failed', async () => {
    await runAccountEnrichment({ orgId: orgA, companyId: acme }, deps([fake('apollo', apolloOk())]));
    const fewer = apolloOk();
    const apollo2 = fake('apollo', async (i, ctx) => {
      const r = await fewer(i, ctx);
      return { ...r, jobPostings: r.jobPostings!.slice(0, 2) };
    });
    await runAccountEnrichment({ orgId: orgA, companyId: acme, force: true }, deps([apollo2]));
    expect(await prisma.companyJobPosting.count({ where: { companyId: acme } })).toBe(2);
    const failed = fake('apollo', async () => ({ provider: 'apollo', status: 'error', fields: { employeeCount: 5 }, jobPostings: null, creditsUsed: 2, error: '500' }));
    const res = await runAccountEnrichment({ orgId: orgA, companyId: acme, force: true }, deps([failed]));
    expect(res.status).toBe('partial');
    expect(await prisma.companyJobPosting.count({ where: { companyId: acme } })).toBe(2);
  });

  it('not configured: no calls, no credits, no cache, values untouched', async () => {
    const off = (id: EnrichmentProviderId): EnrichmentProvider => ({
      id,
      configured: () => false,
      enrich: async () => ({ provider: id, status: 'not_configured', fields: {}, jobPostings: null, creditsUsed: 0 }),
    });
    const res = await runAccountEnrichment({ orgId: orgA, companyId: beta }, deps([off('apollo'), off('seamless')]));
    expect(res).toMatchObject({ outcome: 'refreshed', status: 'not_configured', credits: 0 });
    const row = await prisma.companyFirmographics.findUniqueOrThrow({ where: { companyId: beta } });
    expect(row.expiresAt).toBeNull();
    expect(row.projects).toEqual([]);
    expect(await prisma.enrichmentCreditUsage.count({ where: { orgId: orgA } })).toBe(0);
  });

  it('budget exhausted: the real Apollo adapter makes no HTTP call', async () => {
    let httpCalls = 0;
    const apollo = createApolloProvider({ env: { APOLLO_API_KEY: 'test-key-not-real' }, fetchImpl: async () => (httpCalls++, new Response('{}')) });
    const res = await runAccountEnrichment({ orgId: orgA, companyId: acme }, deps([apollo], { monthlyBudget: { apollo: 0, seamless: 0 } }));
    expect(res.status).toBe('budget_exceeded');
    expect(httpCalls).toBe(0);
    expect(await prisma.enrichmentCreditUsage.count({ where: { orgId: orgA } })).toBe(0);
  });

  it('website is used as the domain fallback; no domain at all reaches providers as null', async () => {
    const apollo = fake('apollo', async () => ({ provider: 'apollo', status: 'no_domain', fields: {}, jobPostings: null, creditsUsed: 0 }));
    await runAccountEnrichment({ orgId: orgA, companyId: beta }, deps([apollo]));
    await runAccountEnrichment({ orgId: orgA, companyId: nodomain }, deps([apollo]));
    expect(apollo.calls.map((c) => c.domain)).toEqual(['https://www.beta.test', null]);
    expect((await prisma.companyFirmographics.findUniqueOrThrow({ where: { companyId: nodomain } })).status).toBe('no_domain');
  });

  it('resumes a pending Seamless request even inside the TTL, without new credits', async () => {
    const pending = fake('seamless', async () => ({ provider: 'seamless', status: 'pending', fields: {}, jobPostings: null, creditsUsed: 1, pendingRequestId: 'rq-9' }));
    const apollo = fake('apollo', apolloOk({ fields: { employeeCount: 3 } }));
    await runAccountEnrichment({ orgId: orgA, companyId: acme }, deps([apollo, pending]));
    let row = await prisma.companyFirmographics.findUniqueOrThrow({ where: { companyId: acme } });
    expect(row.status).toBe('partial');
    expect(row.providerStatus).toMatchObject({ seamless: { status: 'pending', pendingRequestId: 'rq-9' } });
    const done = fake('seamless', seamlessOk);
    await runAccountEnrichment({ orgId: orgA, companyId: acme }, deps([apollo, done], {}, new Date('2026-11-01T00:00:00Z')));
    expect(done.calls[0]!.pendingRequestId).toBe('rq-9');
    row = await prisma.companyFirmographics.findUniqueOrThrow({ where: { companyId: acme } });
    expect((row.providerStatus as Record<string, Record<string, unknown>>).seamless!.pendingRequestId).toBeUndefined();
  });

  it('rate limited with nothing gathered throws so BullMQ retries', async () => {
    const limited = fake('apollo', async () => ({ provider: 'apollo', status: 'rate_limited', fields: {}, jobPostings: null, creditsUsed: 1, retryAfterMs: 30_000 }));
    await expect(runAccountEnrichment({ orgId: orgA, companyId: acme }, deps([limited]))).rejects.toMatchObject({ retryAfterMs: 30_000 });
  });

  it('tenant isolation: another org cannot enrich the company', async () => {
    const apollo = fake('apollo', apolloOk());
    expect(await runAccountEnrichment({ orgId: orgB, companyId: acme }, deps([apollo]))).toEqual({ outcome: 'company_not_found' });
    expect(apollo.calls).toHaveLength(0);
  });

  it('uses the LLM relabel when the org has one', async () => {
    const d = deps([fake('apollo', apolloOk())]);
    d.projectLlm = async () => async () => JSON.stringify({ projects: [{ id: 'data_platform:EMEA', name: 'UK lakehouse on Snowflake', rationale: 'Six data roles in London led by a Snowflake architect.' }] });
    await runAccountEnrichment({ orgId: orgA, companyId: acme }, d);
    const row = await prisma.companyFirmographics.findUniqueOrThrow({ where: { companyId: acme } });
    expect((row.projects as Array<Record<string, unknown>>)[0]).toMatchObject({ name: 'UK lakehouse on Snowflake', method: 'rules+llm', confidence: 'medium' });
  });
});
