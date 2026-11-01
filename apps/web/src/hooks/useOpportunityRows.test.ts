import { describe, expect, it } from 'vitest';

import { opportunityVizIsPartial } from './useOpportunityRows';

describe('opportunityVizIsPartial', () => {
  it('is partial only when the chart snapshot has another page', () => {
    // WHY: a full book must keep "won this year". A cursor means older bids are missing.
    expect(opportunityVizIsPartial(undefined)).toBe(false);
    expect(opportunityVizIsPartial({ nextCursor: null })).toBe(false);
    expect(opportunityVizIsPartial({ nextCursor: 'more' })).toBe(true);
  });
});
