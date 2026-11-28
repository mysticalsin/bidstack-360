import { describe, expect, it } from 'vitest';

import { performanceBreakdown } from './performance-breakdown';

describe('performanceBreakdown', () => {
  it('opens the bids each performance chart is drawn from', () => {
    // Revenue bars are won actuals plus the open forecast. A lost bid is in neither.
    expect(performanceBreakdown('revenue')).toEqual({ book: 'forecast' });
    // Win rate is the share of closed bids. An open bid is not in that rate.
    expect(performanceBreakdown('winrate')).toEqual({ book: 'closed' });
    // Top-account bars are won plus open. Lost value is left off those bars.
    expect(performanceBreakdown('accounts')).toEqual({ book: 'accounts' });
  });
});
