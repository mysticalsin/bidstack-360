import { describe, expect, it } from 'vitest';

import { OpportunityFilter } from './opportunity.js';

describe('OpportunityFilter query flags', () => {
  it('reads overdue=false as false', () => {
    expect(OpportunityFilter.parse({ overdue: 'false' }).overdue).toBe(false);
    expect(OpportunityFilter.parse({ overdue: '0' }).overdue).toBe(false);
  });

  it('reads overdue=true as true', () => {
    expect(OpportunityFilter.parse({ overdue: 'true' }).overdue).toBe(true);
    expect(OpportunityFilter.parse({ overdue: true }).overdue).toBe(true);
  });

  it('rejects a flag that is not a boolean', () => {
    expect(OpportunityFilter.safeParse({ overdue: 'maybe' }).success).toBe(false);
  });
});
