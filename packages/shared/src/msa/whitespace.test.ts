import { describe, expect, it } from 'vitest';

import {
  buildWhitespaceDigest,
  isoWeek,
  evaluateWhitespace,
  joinLineLabels,
  rankWhitespace,
  resolveWhitespaceDecision,
  WHITESPACE_DISMISS_DAYS,
  WHITESPACE_FACTOR_MAX,
  type WhitespaceInput,
} from './whitespace.js';

const NOW = Date.parse('2026-11-07T12:00:00Z');

const hemaEntity = {
  id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  slug: 'hema',
  name: 'HEMA',
  brandFamily: 'amaris' as const,
  businessLines: ['health_economics', 'market_access', 'pharma'],
  verificationStatus: 'verified' as const,
};

function pfizer(overrides: Partial<WhitespaceInput> = {}): WhitespaceInput {
  return {
    msa: {
      msaId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      msaTitle: 'Pfizer Global Master Services Agreement',
      status: 'active',
      expiryDate: '2027-03-31T00:00:00.000Z',
      companyId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      companyName: 'Pfizer',
      signingEntity: hemaEntity,
      scopeOfServices:
        'Supplier and its group companies may provide any services ordered under a Statement of Work worldwide, including information technology and engineering services.',
      affiliatesClause: 'Affiliates of Client may order services under this Agreement by signing a local Statement of Work.',
      scopeCitation: { page: 2, clause: 'Clause 2.1', excerpt: 'any services ordered under a Statement of Work worldwide, including information technology' },
      affiliatesCitation: { page: 3, clause: 'Clause 4', excerpt: 'Affiliates of Client may order services' },
      countries: ['US', 'GB', 'FR', 'DE', 'BE', 'IE'],
      rateCard: [
        { role: 'HEOR Consultant' },
        { role: 'Cloud Data Engineer' },
        { role: 'SAP Consultant' },
        { role: 'Validation Engineer' },
      ],
    },
    activity: { opportunityLines: ['health_economics'], projectLines: ['digital'], revenueLines: ['pharma'] },
    accountCountries: ['US', 'GB', 'FR', 'DE'],
    intel: {
      hiring: [
        { title: 'Senior Cloud Platform Engineer', skills: ['AWS', 'cloud'], url: 'https://careers.example.test/pfizer/1' },
        { title: 'SAP S/4HANA Lead', skills: ['SAP'], url: 'https://careers.example.test/pfizer/2' },
        { title: 'Manufacturing Automation Engineer', skills: ['industrial automation'], url: 'https://careers.example.test/pfizer/3' },
      ],
      themes: [{ title: 'Digital manufacturing and cloud data platform', url: 'https://news.example.test/pfizer/theme' }],
      news: [{ title: 'Pfizer expands software engineering hub', url: 'https://news.example.test/pfizer/hub' }],
    },
    size: { employees: 81_000 },
    ...overrides,
  };
}

describe('evaluateWhitespace', () => {
  it('Pfizer via HEMA global MSA: top flag for IT or Engineering with a cited scope', () => {
    const flag = evaluateWhitespace(pfizer(), NOW);
    expect(flag).not.toBeNull();
    expect(flag!.headline).toBe('Global MSA via HEMA, no IT or Engineering business yet');
    expect(flag!.lines).toEqual(['it', 'engineering']);
    expect(flag!.global).toBe(true);
    expect(flag!.score).toBeGreaterThanOrEqual(85);
    expect(flag!.score).toBeLessThanOrEqual(100);
    const scope = flag!.factors.find((f) => f.key === 'scope');
    expect(scope?.points).toBe(WHITESPACE_FACTOR_MAX.scope);
    expect(scope?.citations[0]).toMatchObject({ kind: 'clause', clause: 'Clause 2.1' });
    expect(flag!.scopeAllowsOtherServices).toBe(true);
  });

  it('shows every factor with points, max and at least one citation when it scores', () => {
    const flag = evaluateWhitespace(pfizer(), NOW)!;
    expect(flag.factors.map((f) => f.key)).toEqual(['scope', 'coverage', 'affiliates', 'rate_card', 'renewal', 'intel', 'size']);
    expect(flag.factors.reduce((sum, f) => sum + f.points, 0)).toBe(flag.score);
    for (const f of flag.factors) {
      expect(f.points).toBeLessThanOrEqual(f.max);
      if (f.points > 0 && f.key !== 'size' && f.key !== 'renewal') expect(f.citations.length).toBeGreaterThan(0);
    }
    expect(Object.values(WHITESPACE_FACTOR_MAX).reduce((a, b) => a + b, 0)).toBe(100);
    const rate = flag.factors.find((f) => f.key === 'rate_card')!;
    expect(rate.citations.map((c) => c.label)).toEqual(expect.arrayContaining(['Cloud Data Engineer', 'SAP Consultant', 'Validation Engineer']));
    const intel = flag.factors.find((f) => f.key === 'intel')!;
    expect(intel.citations.some((c) => c.url === 'https://careers.example.test/pfizer/1')).toBe(true);
  });

  it('extends evaluateLeverage: no flag when the MSA is expired or every line is already sold', () => {
    expect(evaluateWhitespace(pfizer({ msa: { ...pfizer().msa, expiryDate: '2026-01-01T00:00:00.000Z' } }), NOW)).toBeNull();
    expect(
      evaluateWhitespace(pfizer({ activity: { opportunityLines: ['it', 'engineering', 'digital'], projectLines: [], revenueLines: [] } }), NOW),
    ).toBeNull();
  });

  it('a restrictive local MSA scores lower and says MSA, not Global MSA', () => {
    const local = evaluateWhitespace(
      pfizer({
        msa: {
          ...pfizer().msa,
          msaTitle: 'Northwind HEMA MSA',
          companyName: 'Northwind Pharma',
          scopeOfServices: 'Health economics and market access. The scope does not include information technology.',
          affiliatesClause: 'Affiliates of the Client may not order services without an amendment.',
          countries: ['FR'],
          rateCard: [{ role: 'HEOR Consultant' }],
          expiryDate: '2029-03-01T00:00:00.000Z',
        },
        intel: { hiring: [], themes: [], news: [] },
        size: { employees: 900 },
        activity: { opportunityLines: [], projectLines: [], revenueLines: [] },
      }),
      NOW,
    )!;
    expect(local.headline).toBe('MSA via HEMA, no IT, Engineering or Digital business yet');
    expect(local.global).toBe(false);
    expect(local.scopeNeedsAmendment).toBe(true);
    expect(local.score).toBeLessThan(evaluateWhitespace(pfizer(), NOW)!.score);
    expect(local.score).toBeLessThan(50);
  });

  it('renewal window adds points close to expiry', () => {
    const soon = evaluateWhitespace(pfizer(), NOW)!.factors.find((f) => f.key === 'renewal')!;
    const far = evaluateWhitespace(pfizer({ msa: { ...pfizer().msa, expiryDate: '2030-01-01T00:00:00.000Z' } }), NOW)!.factors.find(
      (f) => f.key === 'renewal',
    )!;
    expect(soon.points).toBeGreaterThan(far.points);
  });

  it('evidence hash changes only when evidence changes', () => {
    const a = evaluateWhitespace(pfizer(), NOW)!;
    const b = evaluateWhitespace(pfizer(), NOW)!;
    expect(a.evidenceHash).toBe(b.evidenceHash);
    const c = evaluateWhitespace(
      pfizer({ intel: { ...pfizer().intel, news: [...pfizer().intel.news, { title: 'Pfizer opens cloud center', url: 'https://news.example.test/x' }] } }),
      NOW,
    )!;
    expect(c.evidenceHash).not.toBe(a.evidenceHash);
  });
});

describe('rankWhitespace', () => {
  it('orders by score, then company name', () => {
    const top = evaluateWhitespace(pfizer(), NOW)!;
    const low = evaluateWhitespace(pfizer({ size: { employees: 50 }, intel: { hiring: [], themes: [], news: [] } }), NOW)!;
    expect(rankWhitespace([low, top]).map((f) => f.score)).toEqual([top.score, low.score]);
  });
});

describe('resolveWhitespaceDecision', () => {
  const hash = 'h1';
  it('new when there is no decision', () => {
    expect(resolveWhitespaceDecision([], 'it', hash, NOW)).toEqual({ state: 'new', suppressed: false });
  });
  it('dismissed lines stay hidden for 90 days unless the evidence changes', () => {
    const decidedAt = new Date(NOW - 10 * 86_400_000).toISOString();
    const d = [{ line: 'it', state: 'dismissed' as const, evidenceHash: hash, decidedAt, reason: 'Client uses an incumbent' }];
    expect(resolveWhitespaceDecision(d, 'it', hash, NOW)).toMatchObject({ state: 'dismissed', suppressed: true });
    expect(resolveWhitespaceDecision(d, 'it', 'h2', NOW)).toEqual({ state: 'new', suppressed: false });
    const old = [{ ...d[0]!, decidedAt: new Date(NOW - (WHITESPACE_DISMISS_DAYS + 1) * 86_400_000).toISOString() }];
    expect(resolveWhitespaceDecision(old, 'it', hash, NOW)).toEqual({ state: 'new', suppressed: false });
    expect(resolveWhitespaceDecision(d, 'engineering', hash, NOW)).toEqual({ state: 'new', suppressed: false });
  });
  it('accepted stays accepted', () => {
    const d = [{ line: 'it', state: 'accepted' as const, evidenceHash: hash, decidedAt: new Date(NOW).toISOString(), reason: null }];
    expect(resolveWhitespaceDecision(d, 'it', 'other', NOW)).toMatchObject({ state: 'accepted', suppressed: false });
  });
});

describe('joinLineLabels', () => {
  it('reads naturally', () => {
    expect(joinLineLabels(['it'])).toBe('IT');
    expect(joinLineLabels(['it', 'engineering'])).toBe('IT or Engineering');
    expect(joinLineLabels(['it', 'engineering', 'digital'])).toBe('IT, Engineering or Digital');
  });
});

describe('buildWhitespaceDigest', () => {
  const flag = (msaId: string, score: number, headline: string, state: 'new' | 'accepted' = 'new') => ({
    msaId,
    companyName: msaId,
    score,
    headline,
    state,
    evidenceHash: `h-${msaId}`,
  });

  it('keeps only the top 3 new flags and builds an email draft', () => {
    const d = buildWhitespaceDigest(
      [flag('a', 70, 'A'), flag('b', 95, 'B'), flag('c', 40, 'C'), flag('d', 99, 'D', 'accepted'), flag('e', 80, 'E')],
      { ownerName: 'Sam', week: '2026-W45' },
    )!;
    expect(d.flags.map((f) => f.msaId)).toEqual(['b', 'e', 'a']);
    expect(d.url).toBe('/agreements/whitespace?digest=2026-W45');
    expect(d.title).toBe('3 whitespace flags this week');
    expect(d.body.split('\n')).toEqual(['95 B', '80 E', '70 A']);
    expect(d.email.subject).toBe('Whitespace: 3 flags for 2026-W45');
    expect(d.email.body).toContain('Hi Sam,');
    expect(d.email.body).not.toMatch(/\u2014/);
  });

  it('returns null with no new flags', () => {
    expect(buildWhitespaceDigest([flag('d', 99, 'D', 'accepted')], { ownerName: 'Sam', week: '2026-W45' })).toBeNull();
  });

  it('isoWeek labels weeks', () => {
    expect(isoWeek(new Date('2026-11-07T12:00:00Z'))).toBe('2026-W45');
    expect(isoWeek(new Date('2027-01-01T12:00:00Z'))).toBe('2026-W53');
  });
});
