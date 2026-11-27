import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ForecastCard } from './DashboardVisuals';
import { performanceRevenueQuarters } from './performance-revenue';
import { fmtCompact, type OppRow } from '@/components/viz/viz-data';

// Demo OP-0005 Stellantis is closed won for 620,000. The close stamp is
// 25 Nov 2026 (Q4). The demo due date is 45 days out, 9 Jan 2027 (Q1).
// The projection still places that win on the due date. The revenue chart
// must book it once, in the quarter it closed.
const STELLANTIS: OppRow = {
  id: 'op-0005',
  stage: 'closed_won',
  value: 620_000,
  dueDate: '2027-01-09',
  closedAt: '2026-11-25T15:00:00.000Z',
  customer: 'Stellantis',
};

const OPEN: OppRow = {
  id: 'op-0002',
  stage: 's4_negotiation',
  value: 850_000,
  dueDate: '2027-01-09',
  customer: 'IKEA',
};

const projection = {
  periods: [
    {
      label: 'Q4 2026',
      openMicros: 0,
      weightedMicros: 0,
      wonMicros: 0,
      manualCommitMicros: null,
    },
    {
      label: 'Q1 2027',
      openMicros: 6_200_000 * 1e6,
      weightedMicros: 2_755_000 * 1e6,
      wonMicros: 620_000 * 1e6,
      manualCommitMicros: null,
    },
  ],
};

describe('performance revenue quarters', () => {
  it('books a closed win in the close quarter and not again on the due date', () => {
    expect(performanceRevenueQuarters([STELLANTIS, OPEN], projection.periods)).toEqual([
      { label: 'Q4 2026', won: 620_000, weighted: 0, open: 0 },
      { label: 'Q1 2027', won: 0, weighted: 2_755_000, open: 6_200_000 },
    ]);
  });

  it('keeps the projection won amount when the bid rows have no closed win', () => {
    // A chart with no closed bid still has to show a win the projection reported.
    expect(
      performanceRevenueQuarters([OPEN], [
        {
          label: 'Q1 2027',
          openMicros: 850_000 * 1e6,
          weightedMicros: 637_500 * 1e6,
          wonMicros: 100_000 * 1e6,
        },
      ]),
    ).toEqual([{ label: 'Q1 2027', won: 100_000, weighted: 637_500, open: 850_000 }]);
  });
});

describe('Performance revenue chart', () => {
  afterEach(cleanup);

  it('names the closed win once, in the quarter it closed', () => {
    render(<ForecastCard rows={[STELLANTIS, OPEN]} projection={projection} />);
    const won = fmtCompact(620_000);
    const label = screen.getByRole('img').getAttribute('aria-label') ?? '';
    expect(label.split(won).length - 1).toBe(1);
    expect(label).toContain(`Q4 2026: won ${won}`);
    expect(label).not.toContain(`Q1 2027: won ${won}`);
  });
});
