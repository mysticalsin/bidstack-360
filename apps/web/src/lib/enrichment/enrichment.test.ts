import { describe, expect, it } from 'vitest';

import type { AccountWatchdog } from '@/hooks/useAccountWatchdog';

import { breakdown, mergeEnrichmentSignals, recentCount, trendPct } from './aggregate';
import { mockEnrichment } from './mock';

const wd: AccountWatchdog = {
  companyId: 'acct-1',
  monitoring: { enabled: true, identifiers: [], lastCheckedAt: null, lastError: null },
  events: [{ id: 'e1', source: 'sec_edgar', kind: 'X', title: 'Old filing', summary: '', sourceUrl: 'https://x', occurredAt: '2026-01-01T00:00:00Z', implication: 'RISK', implicationRationale: null, severity: 3, status: 'NEW' }],
  earnings: [],
  pastProjects: [],
  history: [],
};

describe('enrichment mock', () => {
  it('is deterministic per company and always flagged as sample', () => {
    const a = mockEnrichment('acct-1');
    expect(mockEnrichment('acct-1')).toEqual(a);
    expect(a.sample).toBe(true);
    expect(a.hiring.roles.length).toBeGreaterThanOrEqual(22);
  });
  it('gives every firmographic field a source and a date', () => {
    const f = mockEnrichment('acct-1').firmographics;
    for (const v of [f.revenue, f.headcount, f.industry, f.locations]) {
      expect(v?.source).toBeTruthy();
      expect(Number.isNaN(Date.parse(v!.asOf))).toBe(false);
    }
  });
  it('backs every project with postings that exist', () => {
    const e = mockEnrichment('acct-1');
    const ids = new Set(e.hiring.roles.map((r) => r.id));
    for (const p of e.projects) {
      expect(p.evidence.length).toBe(p.postingCount);
      expect(p.evidence.every((r) => ids.has(r.id))).toBe(true);
    }
  });
});

describe('aggregate', () => {
  const roles = mockEnrichment('acct-1').hiring.roles;
  it('breaks roles down by a dimension and keeps totals', () => {
    for (const d of ['function', 'seniority', 'region'] as const) {
      expect(breakdown(roles, d).reduce((n, r) => n + r.count, 0)).toBe(roles.length);
    }
    const sen = breakdown(roles, 'seniority').map((r) => r.label);
    const order = ['Entry', 'Mid', 'Senior', 'Lead', 'Director+'].filter((l) => sen.includes(l));
    expect(sen).toEqual(order);
  });
  it('counts recent postings and the headcount trend', () => {
    expect(recentCount(roles, '2026-10-30', 30)).toBeLessThanOrEqual(roles.length);
    expect(trendPct([{ value: 100 }, { value: 110 }])).toBe(10);
    expect(trendPct([{ value: 5 }])).toBeNull();
  });
  it('folds medium/high projects into watchdog signals, newest first, once', () => {
    const e = mockEnrichment('acct-1');
    const merged = mergeEnrichmentSignals(wd, e);
    const added = merged.events.filter((x) => x.source === 'enrichment');
    expect(added.length).toBe(e.projects.filter((p) => p.confidence !== 'low').length);
    expect(added.every((x) => x.implication === 'OPPORTUNITY' && x.title.startsWith('Sample: Potential project:'))).toBe(true);
    expect(merged.events[0]!.occurredAt >= merged.events.at(-1)!.occurredAt).toBe(true);
    expect(mergeEnrichmentSignals(merged, e).events.length).toBe(merged.events.length);
    expect(mergeEnrichmentSignals(wd, mockEnrichment('other'))).toBe(wd);
  });
});
