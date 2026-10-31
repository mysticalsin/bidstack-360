import { describe, expect, it } from 'vitest';

import { recentItemsFromDeals } from './RecentOpportunitiesCard';

describe('recentItemsFromDeals', () => {
  it('keeps an account deal that sits outside the first page of the global list', () => {
    const items = recentItemsFromDeals([
      {
        id: 'deal-1',
        name: 'DNB Bank — Cloud landing zone',
        stage: 'screening',
        amountMicros: 2_700_000_000_000,
        companyName: 'DNB Bank',
      },
    ]);

    expect(items).toEqual([
      {
        id: 'deal-1',
        name: 'DNB Bank — Cloud landing zone',
        customer: 'DNB Bank',
        value: 2_700_000,
        stage: 'screening',
      },
    ]);
  });
});
