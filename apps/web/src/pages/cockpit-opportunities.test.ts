import { describe, expect, it } from 'vitest';

import { recentOpportunityCaption } from './cockpit-opportunities';

const WHOLE_LIST = 'Open opportunities linked to CI Financial';

describe('recent opportunity caption', () => {
  it('does not describe a short opportunity slice as every opportunity', () => {
    // WHY: the cockpit shows five open opportunities and the caption treated
    // that slice as the loaded set. One more loaded row means those rows are
    // not every opportunity. A slice that matches the loaded set keeps the
    // old wording. No total is invented.
    expect(recentOpportunityCaption(5, true, WHOLE_LIST)).toBe(
      '5 in the latest 5, not every opportunity',
    );
    expect(recentOpportunityCaption(5, true, WHOLE_LIST)).not.toBe(WHOLE_LIST);
    expect(recentOpportunityCaption(2, true, WHOLE_LIST)).toMatch(/not every opportunity/i);
    expect(recentOpportunityCaption(2, true, WHOLE_LIST)).not.toMatch(/linked to/i);

    expect(recentOpportunityCaption(5, false, WHOLE_LIST)).toBe(WHOLE_LIST);
    expect(recentOpportunityCaption(2, false, WHOLE_LIST)).toBe(WHOLE_LIST);
    expect(recentOpportunityCaption(1, false, 'Latest portfolio activity across all customers')).toBe(
      'Latest portfolio activity across all customers',
    );
    expect(recentOpportunityCaption(2, false, WHOLE_LIST)).not.toMatch(/not every/i);
  });
});
