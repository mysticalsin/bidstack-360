import { describe, expect, it } from 'vitest';

import { enrichmentProjectAnchor, enrichmentWatchRows, parseStoredProjects } from './enrichment-watchdog.js';

const project = (id: string, confidence: 'high' | 'medium' | 'low', extra: Record<string, unknown> = {}) => ({
  id,
  kind: id.split(':')[0],
  name: `Project ${id}`,
  rationale: 'Many data roles.',
  confidence,
  region: 'EMEA',
  postingCount: 12,
  seniorCount: 2,
  skills: ['snowflake'],
  evidence: [
    { postingId: 'p1', title: 'Data Engineer', url: 'https://jobs.example/1', region: 'EMEA', seniority: 'senior', postedAt: '2026-10-20T00:00:00Z', source: 'apollo' },
    { postingId: 'p2', title: 'Data Engineer', url: null, region: 'EMEA', seniority: 'mid', postedAt: null, source: 'apollo' },
  ],
  method: 'rules',
  ...extra,
});

describe('enrichment watchdog rows', () => {
  const base = { orgId: 'o1', companyId: 'c1', fetchedAt: new Date('2026-10-31T12:00:00Z') };

  it('keeps medium and high projects as opportunity events keyed by project id', () => {
    const rows = enrichmentWatchRows({ ...base, projects: [project('data_platform:EMEA', 'high'), project('crm:AMER', 'medium'), project('erp:APAC', 'low')] });
    expect(rows.map((r) => [r.externalId, r.severity])).toEqual([['data_platform:EMEA', 2], ['crm:AMER', 1]]);
    expect(rows[0]).toMatchObject({
      source: 'enrichment',
      kind: 'NEWS_SIGNAL',
      implication: 'OPPORTUNITY',
      confirmed: false,
      title: 'Potential project: Project data_platform:EMEA',
      sourceUrl: '/accounts/c1#enrichment-project-data_platform-EMEA',
      occurredAt: base.fetchedAt,
    });
    expect(rows[0]!.summary).toContain('High confidence, from 12 job postings.');
    expect(rows[0]!.payload.evidenceUrls).toEqual(['https://jobs.example/1']);
  });

  it('honours minConfidence and drops malformed stored projects', () => {
    expect(enrichmentWatchRows({ ...base, projects: [project('erp:APAC', 'low')], minConfidence: 'low' })).toHaveLength(1);
    expect(parseStoredProjects([{ id: 'x' }, null, project('a:EMEA', 'high')])).toHaveLength(1);
    expect(parseStoredProjects('nope')).toEqual([]);
  });

  it('makes DOM-safe anchors', () => {
    expect(enrichmentProjectAnchor('gtm_expansion:across regions')).toBe('enrichment-project-gtm_expansion-across-regions');
  });
});
