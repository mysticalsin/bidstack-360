import { describe, expect, it } from 'vitest';

import { rollupProposalAnalytics } from './proposal-analytics.js';

const MICROS = 1_000_000n;
/** 61520 units. One synthetic bid, the amount the draft book treats as unpaid. */
const UNPAID = 61_520n * MICROS;
const OTHER = 850_000n * MICROS;

const SA = '11111111-1111-4111-8111-111111111111';
const MB = '22222222-2222-4222-8222-222222222222';
const SHARED = '33333333-3333-4333-8333-333333333333';
const SINGLE = '44444444-4444-4444-8444-444444444444';

describe('rollupProposalAnalytics', () => {
  it('books 61520 once when two proposals share that bid', () => {
    // WHY: the demo book has two proposals on one opportunity (a draft and a
    // review). The analytics join added that opportunity's value on each
    // proposal, so the pipeline total and that owner's value were double.
    // 61520 units stands for that single unpaid bid. A second bid must still
    // be added, and both proposals must still be counted.
    const rollup = rollupProposalAnalytics([
      {
        status: 'draft',
        ownerId: SA,
        opportunityId: SHARED,
        count: 1,
        valueMicros: UNPAID,
      },
      {
        status: 'review',
        ownerId: SA,
        opportunityId: SHARED,
        count: 1,
        valueMicros: UNPAID,
      },
      {
        status: 'approved',
        ownerId: MB,
        opportunityId: SINGLE,
        count: 1,
        valueMicros: OTHER,
      },
    ]);

    const units = (micros: bigint) => micros / MICROS;
    const sa = rollup.byOwner.find((row) => row.ownerId === SA);
    const mb = rollup.byOwner.find((row) => row.ownerId === MB);

    expect(units(rollup.totalValueMicros)).toBe(61_520n + 850_000n);
    expect(String(units(sa?.totalValueMicros ?? -1n))).toBe('61520');
    expect(units(mb?.totalValueMicros ?? -1n)).toBe(850_000n);
    expect(sa?.count).toBe(2);
    expect(rollup.totalCount).toBe(3);
    expect(rollup.byStatus).toEqual([
      { status: 'draft', count: 1 },
      { status: 'review', count: 1 },
      { status: 'approved', count: 1 },
    ]);
  });

  it('counts a proposal with no linked bid and adds no value', () => {
    // WHY: a proposal that was not tied to an opportunity is still a proposal.
    // It is not a price. Filling the total from a missing bid would invent one.
    const rollup = rollupProposalAnalytics([
      {
        status: 'draft',
        ownerId: null,
        opportunityId: null,
        count: 1,
        valueMicros: 0n,
      },
    ]);

    expect(rollup.totalCount).toBe(1);
    expect(rollup.totalValueMicros).toBe(0n);
    expect(rollup.byOwner).toEqual([{ ownerId: null, count: 1, totalValueMicros: 0n }]);
  });
});
