import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@bidstack/db', () => ({
  prisma: {},
  loadWhitespaceFlags: vi.fn(),
  loadRelationshipMap: vi.fn(),
}));

import type { WhitespaceFlag } from '@bidstack/shared';

let filterWhitespace: typeof import('./msa-whitespace.js').filterWhitespace;
let whitespaceFacets: typeof import('./msa-whitespace.js').whitespaceFacets;
let whitespaceFlagLines: typeof import('./msa-whitespace.js').whitespaceFlagLines;

beforeAll(async () => {
  ({ filterWhitespace, whitespaceFacets, whitespaceFlagLines } = await import('./msa-whitespace.js'));
});

const id = '00000000-0000-4000-8000-000000000001';

function flag(lines: string[], decisionLine: string | null): WhitespaceFlag {
  return {
    id,
    msaId: id,
    msaTitle: 'MSA',
    companyId: id,
    companyName: 'Acme',
    signingEntity: {
      id,
      slug: 'acme',
      name: 'Acme',
      brandFamily: null,
      businessLines: [],
      verificationStatus: 'unverified',
    },
    global: false,
    countries: [],
    lines,
    headline: 'Gap',
    score: 10,
    factors: [],
    scopeAllowsOtherServices: null,
    scopeNeedsAmendment: false,
    expiryDate: null,
    evidenceHash: 'h',
    state: 'new',
    owner: null,
    decisions: decisionLine
      ? [
          {
            line: decisionLine,
            state: 'accepted',
            reason: null,
            decidedAt: '2026-11-01T00:00:00.000Z',
            decidedBy: null,
            crossSellActionId: null,
            opportunityId: null,
          },
        ]
      : [],
  } as WhitespaceFlag;
}

describe('whitespace line filters', () => {
  it('counts and filters a decision line that is not already on the flag lines', () => {
    const rows = [flag(['data'], 'cloud')];
    const facets = whitespaceFacets(rows);
    expect(facets.lines).toEqual(['cloud', 'data']);
    const query = {
      line: 'cloud',
      state: 'all' as const,
      limit: 10,
    };
    const matched = filterWhitespace(rows, query);
    expect(matched).toHaveLength(1);
    const byLine = new Map<string, number>();
    for (const row of matched) {
      for (const line of whitespaceFlagLines(row, 'all')) byLine.set(line, (byLine.get(line) ?? 0) + 1);
    }
    expect(byLine.get('cloud')).toBe(1);
    expect(filterWhitespace(rows, { line: 'cloud', state: 'new', limit: 10 })).toHaveLength(0);
    const fresh = filterWhitespace(rows, { line: 'data', state: 'new', limit: 10 });
    expect(fresh).toHaveLength(1);
    const counted = new Map<string, number>();
    for (const row of fresh) {
      for (const line of whitespaceFlagLines(row, 'new')) counted.set(line, (counted.get(line) ?? 0) + 1);
    }
    expect(counted.get('cloud')).toBeUndefined();
    expect(counted.get('data')).toBe(1);
  });
});
