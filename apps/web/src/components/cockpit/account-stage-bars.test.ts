import { describe, expect, it } from 'vitest';

import {
  ACCOUNT_STAGE_PAGE,
  accountCompanyId,
  accountStageBars,
} from './account-stage-bars';

describe('account stage bars', () => {
  it('sums this account’s bids in stage order and leaves every other bid out', () => {
    // WHY: the cockpit card used to render the portfolio report. A Siemens
    // bid of 2,500 then sat under a strip that still counted the whole book.
    // The bars are only the rows this read returned for that company.
    const bars = accountStageBars([
      { stage: 'closed_won', value: 500 },
      { stage: 's4_negotiation', value: 2_500 },
      { stage: 's1_ongoing', value: 1_000 },
      { stage: 's1_ongoing', value: 250 },
      { stage: null, value: 10 },
    ]);

    expect(bars.map((bar) => bar.stage)).toEqual([
      's1_ongoing',
      's4_negotiation',
      'closed_won',
      'unknown',
    ]);
    expect(bars.find((bar) => bar.stage === 's1_ongoing')).toEqual({
      stage: 's1_ongoing',
      count: 2,
      valueSum: 1_250,
    });
    expect(bars.reduce((sum, bar) => sum + bar.count, 0)).toBe(5);
    expect(bars.reduce((sum, bar) => sum + bar.valueSum, 0)).toBe(4_260);
  });

  it('accepts a company uuid and refuses a name, a path, or a script', () => {
    // WHY: the id is the only thing that may become a query. A stored name
    // must not be sent, or the card searches the book instead of this account.
    const id = '11111111-1111-4111-8111-111111111111';
    expect(accountCompanyId(id)).toBe(id);
    expect(accountCompanyId('Siemens')).toBeNull();
    expect(accountCompanyId('../admin')).toBeNull();
    expect(accountCompanyId('javascript:alert(1)')).toBeNull();
    expect(accountCompanyId('')).toBeNull();
    expect(ACCOUNT_STAGE_PAGE).toBeLessThanOrEqual(200);
  });
});
