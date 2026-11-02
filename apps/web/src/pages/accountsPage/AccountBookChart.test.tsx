import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AccountBookChart } from './AccountBookChart';
import { ACCOUNT_BOOK_PAGE_CAPTION } from './accountBookSeries';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback: string, values?: Record<string, unknown>) => {
      if (key === 'accounts.book.dealCount_one') return `${values?.count} deal`;
      if (key === 'accounts.book.dealCount_other') return `${values?.count} deals`;
      return fallback;
    },
  }),
}));

vi.mock('framer-motion', () => ({
  useReducedMotion: () => true,
}));

describe('AccountBookChart', () => {
  afterEach(cleanup);

  it('draws the loaded page and leaves a lost stage off the bars', () => {
    // WHY: the chart is the open shape of this view. A lost stage whose name
    // still reads like an open step must not lengthen a bar, and the caption
    // has to stay when the deals are only a page.
    render(
      <AccountBookChart
        companyIds={new Set(['a'])}
        deals={[
          {
            companyId: 'a',
            stage: 'closed_lost',
            stageName: 'S4 Negotiation',
            amountMicros: '8000000',
          },
          { companyId: 'a', stage: 'new', stageName: 'S1 Lead', amountMicros: '1000000' },
          { companyId: 'a', stage: 'closed_won', stageName: 'Closed Won', amountMicros: '9000000' },
        ]}
      />,
    );

    expect(screen.getByTestId('account-book-caption').textContent).toBe(ACCOUNT_BOOK_PAGE_CAPTION);
    const chart = screen.getByRole('img');
    expect(chart.getAttribute('aria-label')).toMatch(/S1 Lead/);
    expect(chart.getAttribute('aria-label')).not.toMatch(/S4 Negotiation|Closed Won/);
    expect(chart.textContent).toMatch(/1 deal/);
    expect(chart.textContent).not.toMatch(/8 unspecified|9 unspecified/);
  });
});
