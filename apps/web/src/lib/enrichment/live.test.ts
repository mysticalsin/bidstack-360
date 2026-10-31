import type { Firmographics } from '@bidstack/shared';
import { describe, expect, it } from 'vitest';

import { fromApi, isSampleStatus, type ApiHiring, type ApiProjects } from './live';

const at = '2026-10-31T21:00:00.000Z';
const f = {
  companyId: 'c1', status: 'ok', stale: false, fetchedAt: at, domain: 'example.com',
  annualRevenueUsd: 2_500_000_000, revenueRange: null, employeeCount: 4200, employeeRange: '1001-5000',
  headcountGrowth12m: 0.0834, industry: 'Financial services', industries: [],
  locations: [{ kind: 'hq', city: 'Toronto', state: 'Ontario', country: 'Canada' }, { kind: 'subsidiary', city: null, state: null, country: 'United States' }, { kind: 'subsidiary', city: null, state: null, country: 'United States' }],
  providers: { apollo: { status: 'ok' } },
  provenance: { employeeCount: { source: 'apollo', fetchedAt: at }, industry: { source: 'apollo', fetchedAt: at } },
} as unknown as Firmographics;
const posting = (id: string, fn: string, sen: string) => ({
  id, source: 'apollo', title: `${fn} role`, url: `https://jobs.example/${id}`, city: 'Toronto', country: 'Canada',
  region: 'AMER', function: fn, seniority: sen, skills: [], postedAt: null,
});
const h = {
  companyId: 'c1', fetchedAt: at, postingsTotal: 120,
  postings: [posting('p1', 'data', 'senior'), posting('p2', 'ml_ai', 'mid')],
  hiring: {
    total: 120,
    byFunction: [{ key: 'data', count: 70 }, { key: 'ml_ai', count: 50 }, { key: 'legal', count: 0 }],
    bySeniority: [{ key: 'senior', count: 40 }, { key: 'mid', count: 80 }],
    byRegion: [{ key: 'AMER', count: 120 }],
  },
} as unknown as ApiHiring;
const pr = {
  companyId: 'c1', fetchedAt: at,
  projects: [
    { id: 'data_platform:AMER', name: 'Data platform', rationale: 'r', confidence: 'medium', region: 'AMER', postingCount: 3, method: 'rules', evidence: [] },
    { id: 'ml:AMER', name: 'ML build-out', rationale: 'r', confidence: 'high', region: 'AMER', postingCount: 2, method: 'rules', evidence: [{ postingId: 'p2', title: 'ML', seniority: 'mid', region: 'AMER', postedAt: null, source: 'apollo', url: null }] },
  ],
} as unknown as ApiProjects;

describe('live enrichment mapping', () => {
  it('treats unconfigured / never-enriched as Sample, real runs as live', () => {
    expect(isSampleStatus({ status: 'not_configured', providers: {} } as never)).toBe(true);
    expect(isSampleStatus({ status: 'not_enriched', providers: {} } as never)).toBe(true);
    expect(isSampleStatus({ status: 'error', providers: { apollo: { status: 'not_configured' } } } as never)).toBe(true);
    expect(isSampleStatus(f)).toBe(false);
  });
  it('maps firmographics with provenance, hiring buckets and projects', () => {
    const e = fromApi(f, h, pr);
    expect(e.sample).toBe(false);
    expect(e.firmographics.headcount).toMatchObject({ source: 'Apollo', value: { current: 4200, growth12m: 8.3 } });
    expect(e.firmographics.revenue?.value).toMatchObject({ amount: 2_500_000_000, currency: 'USD' });
    expect(e.firmographics.locations?.value).toEqual([
      { city: 'Toronto', country: 'Canada', hq: true },
      { city: 'United States', country: 'United States', hq: false },
    ]);
    expect(e.hiring.total).toBe(120);
    expect(e.hiring.buckets?.function).toEqual([{ label: 'Data', count: 70 }, { label: 'ML & AI', count: 50 }]);
    expect(e.hiring.buckets?.seniority.map((r) => r.label)).toEqual(['Mid', 'Senior']);
    expect(e.projects.map((p) => p.confidence)).toEqual(['high', 'medium']);
    expect(e.projects[0]!.evidence[0]).toMatchObject({ id: 'p2', seniority: 'Mid', region: 'North America' });
  });
  it('copes with missing hiring and projects', () => {
    const e = fromApi(f, null, null);
    expect(e.hiring.total).toBe(0);
    expect(e.projects).toEqual([]);
  });
});
