// WHY: Revenue and forecast draws the current quarter from the projection,
// which rolls every open bid dated before this quarter into that bar. On the
// demo book that is the whole open number, and the bar reads as new Q4
// business unless the chart says the amount is already past its close date.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ForecastCard } from './DashboardVisuals';
import type { OppRow } from '@/components/viz/viz-data';

const NOW = Date.parse('2026-11-25T15:00:00.000Z');

function row(partial: Partial<OppRow> & Pick<OppRow, 'id'>): OppRow {
  return {
    stage: 's2_sent',
    value: 0,
    dueDate: null,
    customer: 'CI Financial',
    ...partial,
  };
}

const slipped: OppRow[] = [
  row({ id: '2041', stage: 's3_technical_iteration', value: 1_240_000, dueDate: '2026-07-22' }),
  row({ id: '2043', stage: 's4_negotiation', value: 4_800_000, dueDate: '2026-06-30' }),
  row({ id: '2046', stage: 'closed_won', value: 410_000, dueDate: '2026-04-28' }),
];

const projection = {
  periods: [
    {
      label: 'Q4 2026',
      weightedMicros: 3_926_000_000_000,
      wonMicros: 0,
      openMicros: 6_040_000_000_000,
      manualCommitMicros: null,
    },
  ],
};

describe('ForecastCard past-close sentence', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('says the current quarter bar includes open bids already past their close date', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    render(<ForecastCard rows={slipped} projection={projection} />);
    expect(
      screen.getByText('Q4 2026 open pipeline includes 6.04m past its close date.'),
    ).toBeTruthy();
    expect(
      screen.getByRole('img', { name: /Q4 2026 open pipeline includes 6.04m past its close date/ }),
    ).toBeTruthy();
  });

  it('stays quiet when every open close date is still in this quarter', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    render(
      <ForecastCard
        rows={[row({ id: 'later', value: 500_000, dueDate: '2026-12-01' })]}
        projection={{
          periods: [
            {
              label: 'Q4 2026',
              weightedMicros: 200_000_000_000,
              wonMicros: 0,
              openMicros: 500_000_000_000,
              manualCommitMicros: null,
            },
          ],
        }}
      />,
    );
    expect(screen.queryByText(/past its close date/)).toBeNull();
  });
});
