import { describe, expect, it } from 'vitest';

import {
  ACCOUNT_BOOK_PAGE_CAPTION,
  openAccountBookStages,
  type AccountBookDeal,
} from './accountBookSeries';

function deal(overrides: Partial<AccountBookDeal> & Pick<AccountBookDeal, 'stage'>): AccountBookDeal {
  return {
    companyId: 'a',
    stageName: null,
    amountMicros: '1000000',
    ...overrides,
  };
}

describe('openAccountBookStages', () => {
  it('keeps a lost stage out of the open series and keeps the page caption', () => {
    // WHY: the dashboard maps a live lost flag onto closed_lost but can leave
    // the old stage name on the row. Grouping by that name would draw a lost
    // deal as if it were still open. The series is also only the loaded page.
    const series = openAccountBookStages(
      [
        deal({
          stage: 'closed_lost',
          stageName: 'S4 Negotiation',
          amountMicros: '8000000',
        }),
        deal({ stage: 'new', stageName: 'S1 Lead', amountMicros: '1000000' }),
        deal({ stage: 'closed_won', stageName: 'Closed Won', amountMicros: '9000000' }),
        deal({ stage: 'customer', stageName: 'Customer', amountMicros: '2000000' }),
        deal({
          companyId: 'other',
          stage: 'proposal',
          stageName: 'Proposal',
          amountMicros: '3000000',
        }),
      ],
      new Set(['a']),
    );

    expect(series.map((stage) => stage.label)).toEqual(['S1 Lead', 'Customer']);
    expect(series.map((stage) => stage.stage)).not.toContain('closed_lost');
    expect(series.map((stage) => stage.stage)).not.toContain('closed_won');
    expect(series.some((stage) => /negotiation|closed won/i.test(stage.label))).toBe(false);
    expect(series.find((stage) => stage.label === 'S1 Lead')?.valueSumMicros).toBe('1000000');

    expect(ACCOUNT_BOOK_PAGE_CAPTION).toMatch(/page of deals/i);
    expect(ACCOUNT_BOOK_PAGE_CAPTION).toMatch(/this view/i);
    expect(ACCOUNT_BOOK_PAGE_CAPTION).toMatch(/not the full book/i);
    expect(ACCOUNT_BOOK_PAGE_CAPTION.trim().length).toBeGreaterThan(20);
  });
});
