import { describe, expect, it } from 'vitest';

import { taskOpportunityName } from './task-opportunity-title.js';

const ORG = '00000000-0000-4000-8000-000000000001';
const OTHER = '00000000-0000-4000-8000-000000000099';

// A follow-up may only be labeled with a bid that belongs to the caller's
// org. The demo pricing task's bid is CI Financial. Another org's bid name
// must not ride along on the task payload, and a blank name must not.
describe('taskOpportunityName', () => {
  it('returns the bid name when the bid is in this org', () => {
    expect(
      taskOpportunityName({ name: 'CI Financial — IT Modernization & MSP', orgId: ORG }, ORG),
    ).toBe('CI Financial — IT Modernization & MSP');
  });

  it('returns null for another org, a missing bid, or a blank name', () => {
    expect(
      taskOpportunityName({ name: 'CI Financial — IT Modernization & MSP', orgId: OTHER }, ORG),
    ).toBeNull();
    expect(taskOpportunityName(null, ORG)).toBeNull();
    expect(taskOpportunityName(undefined, ORG)).toBeNull();
    expect(taskOpportunityName({ name: '   ', orgId: ORG }, ORG)).toBeNull();
  });
});
