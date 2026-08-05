// The rules that decide how a fact LOOKS. Held vs weak is the load-bearing one:
// getting it wrong paints a source disagreement as low confidence (or worse,
// paints a merely uncertain answer as a contradiction) on the one screen where
// a bid reviewer decides what to trust.

import { describe, expect, it } from 'vitest';

import type { BidFact } from '@/hooks/agent/useBidFacts';
import {
  confidencePct,
  factTone,
  isHeldFact,
  newestFirst,
  pageRange,
  rationaleDetail,
} from './bid-fact-view';

function fact(overrides: Partial<BidFact> = {}): BidFact {
  return {
    id: 'f1',
    opportunityId: 'o1',
    subjectType: 'matrix_row',
    subjectId: 'r1',
    claim: 'YES — hosting is delivered from EU datacentres',
    verdict: 'YES',
    confidenceBps: 9000,
    band: 'VERIFIED',
    assessmentStatus: 'ASSESSED',
    rationale: 'The bid library states this directly',
    status: 'PROPOSED',
    producedByAgentKey: 'compliance-fill',
    decidedByUserId: null,
    decidedAt: null,
    createdAt: '2026-08-01T10:00:00.000Z',
    citations: [],
    ...overrides,
  };
}

describe('isHeldFact', () => {
  it('is held when the worker clamped the score and said so', () => {
    expect(
      isHeldFact(
        fact({ rationale: 'Held: amendment 2 contradicts the base document on SLA.', confidenceBps: 4500 }),
      ),
    ).toBe(true);
  });

  it('is NOT held for a merely weak fact in the same band', () => {
    expect(isHeldFact(fact({ rationale: 'One public page mentions this.', confidenceBps: 3200, band: 'POSSIBLE' }))).toBe(
      false,
    );
  });

  it('is NOT held when a high-confidence rationale happens to start with the word', () => {
    // The clamp is the corroborating signal: a 0.9 fact cannot be a contradiction.
    expect(isHeldFact(fact({ rationale: 'Held over from the 2025 submission.', confidenceBps: 9000 }))).toBe(false);
  });

  it('is not held with no rationale at all', () => {
    expect(isHeldFact(fact({ rationale: null }))).toBe(false);
  });
});

describe('factTone', () => {
  it('held outranks every band', () => {
    expect(factTone(fact({ rationale: 'Held: sources disagree.', confidenceBps: 4500, band: 'POSSIBLE' }))).toBe('held');
  });

  it('maps the three bands', () => {
    expect(factTone(fact({ band: 'VERIFIED' }))).toBe('verified');
    expect(factTone(fact({ band: 'PROBABLE', confidenceBps: 6000 }))).toBe('probable');
    expect(factTone(fact({ band: 'POSSIBLE', confidenceBps: 3500 }))).toBe('possible');
  });

  it('is unknown — never an error tone — when the band is null', () => {
    expect(factTone(fact({ band: null, confidenceBps: null }))).toBe('unknown');
  });
});

describe('rationaleDetail', () => {
  it('drops the "Held:" prefix so the chip does not stutter', () => {
    expect(
      rationaleDetail(fact({ rationale: 'Held: amendment 2 contradicts the base document.', confidenceBps: 4500 })),
    ).toBe('amendment 2 contradicts the base document.');
  });

  it('leaves an ordinary rationale untouched', () => {
    expect(rationaleDetail(fact({ rationale: 'Two independent sources agree.' }))).toBe(
      'Two independent sources agree.',
    );
  });
});

describe('pageRange', () => {
  it('prints a single page, a range, and nothing at all', () => {
    expect(pageRange({ pageStart: 14, pageEnd: 14 })).toBe('14');
    expect(pageRange({ pageStart: 14, pageEnd: 16 })).toBe('14–16');
    expect(pageRange({ pageStart: 14, pageEnd: null })).toBe('14');
    expect(pageRange({ pageStart: null, pageEnd: null })).toBeNull();
  });
});

describe('confidencePct', () => {
  it('keeps null null — an unassessed row must never render 0%', () => {
    expect(confidencePct(null)).toBeNull();
    expect(confidencePct(0)).toBe(0);
    expect(confidencePct(8542)).toBe(85);
  });
});

describe('newestFirst', () => {
  it('orders by createdAt descending without mutating the input', () => {
    const input = [
      fact({ id: 'a', createdAt: '2026-08-01T10:00:00.000Z' }),
      fact({ id: 'b', createdAt: '2026-08-03T10:00:00.000Z' }),
      fact({ id: 'c', createdAt: '2026-08-02T10:00:00.000Z' }),
    ];
    expect(newestFirst(input).map((item) => item.id)).toEqual(['b', 'c', 'a']);
    expect(input.map((item) => item.id)).toEqual(['a', 'b', 'c']);
  });
});
