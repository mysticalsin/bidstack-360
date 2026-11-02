import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AccountBookChart } from './AccountBookChart';
import { ACCOUNT_BOOK_CAPTION } from './accountBookSeries';

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

  it('draws the recorded open book and leaves a lost stage off the bars', () => {
    // WHY: the chart is the open shape of this view. A lost stage whose name
    // still reads like an open step must not lengthen a bar, and the caption
    // has to name the recorded book.
    render(
      <AccountBookChart
        status="ready"
        stages={[
          {
            stage: 'closed_lost',
            stageName: 'S4 Negotiation',
            count: 1,
            valueSumMicros: '8000000',
          },
          { stage: 'new', stageName: 'S1 Lead', count: 1, valueSumMicros: '1000000' },
          { stage: 'closed_won', stageName: 'Closed Won', count: 1, valueSumMicros: '9000000' },
        ]}
      />,
    );

    expect(screen.getByTestId('account-book-caption').textContent).toBe(ACCOUNT_BOOK_CAPTION);
    expect(screen.getByTestId('account-book-caption').textContent).not.toMatch(/page/i);
    const chart = screen.getByRole('img');
    expect(chart.getAttribute('aria-label')).toMatch(/S1 Lead/);
    expect(chart.getAttribute('aria-label')).not.toMatch(/S4 Negotiation|Closed Won/);
    expect(chart.textContent).toMatch(/1 deal/);
    expect(chart.textContent).not.toMatch(/8 unspecified|9 unspecified/);
  });

  it('does not draw bars when the book failed to load', () => {
    // WHY: a failed book query must not fall back to the loaded deal page
    // and call that page the book.
    render(<AccountBookChart status="error" stages={[{ stage: 'new', stageName: 'S1 Lead', count: 1, valueSumMicros: '1000000' }]} />);

    expect(screen.getByRole('alert').textContent).toMatch(/recorded open book/i);
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.queryByText(/S1 Lead/)).toBeNull();
  });
});
