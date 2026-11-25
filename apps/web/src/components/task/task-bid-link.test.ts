import { describe, expect, it } from 'vitest';

import { taskBidLabel } from './task-bid-link';

const OPP = '00000000-0000-4000-8000-000000020041';

// The demo pricing follow-up's title does not say which bid it is. The label
// is the bid name when this org owns that bid. A blank name, a missing bid,
// or another org's bid must not become the link text.
describe('taskBidLabel', () => {
  it('uses the bid name for the demo pricing follow-up', () => {
    expect(
      taskBidLabel({
        oppId: OPP,
        opportunityName: 'CI Financial — IT Modernization & MSP',
      }),
    ).toBe('CI Financial — IT Modernization & MSP');
  });

  it('returns null when there is no bid, the name is blank, or the name is missing', () => {
    expect(
      taskBidLabel({ oppId: null, opportunityName: 'CI Financial — IT Modernization & MSP' }),
    ).toBeNull();
    expect(taskBidLabel({ oppId: OPP, opportunityName: '   ' })).toBeNull();
    expect(taskBidLabel({ oppId: OPP, opportunityName: null })).toBeNull();
    expect(taskBidLabel({ oppId: OPP })).toBeNull();
  });
});
