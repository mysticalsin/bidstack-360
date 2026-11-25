import { describe, expect, it } from 'vitest';

import { columnWinProbability } from './column-probability';

describe('columnWinProbability', () => {
  it('uses the bid probability, not a funnel ratio or the stage default', () => {
    // IKEA is the only Negotiation bid. The funnel is 50. The stage default
    // is 80. The column has to say 75.
    expect(
      columnWinProbability([{ value: 850_000, probability: 75 }], false),
    ).toBe(75);
  });

  it('weights a shared column by amount so a small bid does not halve a large one', () => {
    // An unweighted mean of 10 and 90 is 50. The 900 bid is the column.
    expect(
      columnWinProbability(
        [
          { value: 100, probability: 10 },
          { value: 900, probability: 90 },
        ],
        false,
      ),
    ).toBe(82);
  });

  it('averages bids that have no amount instead of dividing by zero', () => {
    expect(
      columnWinProbability(
        [
          { value: 0, probability: 20 },
          { value: 0, probability: 40 },
        ],
        false,
      ),
    ).toBe(30);
  });

  it('states 100 on a win and 0 on a loss', () => {
    expect(columnWinProbability([{ value: 620_000, probability: 100 }], false)).toBe(100);
    expect(columnWinProbability([{ value: 430_000, probability: 0 }], false)).toBe(0);
  });

  it('has no probability when the column is empty or the page is not the whole book', () => {
    expect(columnWinProbability([], false)).toBeNull();
    expect(columnWinProbability([{ value: 850_000, probability: 75 }], true)).toBeNull();
  });
});
