import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ForecastProjection } from './ForecastProjection';

const projection = vi.hoisted(() => ({ result: { data: undefined as unknown, isLoading: false, isError: false } }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock('@/hooks/useForecasts', () => ({ useForecastProjection: () => projection.result }));
vi.mock('@/hooks/useFormatMoney', () => ({
  useFormatMoney: () => ({ formatMoneyMicros: (m: number) => `R$${m / 1e6}` }),
}));

afterEach(cleanup);

const period = (
  label: string,
  open: number,
  weighted: number,
  won: number,
  overdueOpen = 0,
) => ({
  period: label,
  label,
  openMicros: open * 1e6,
  weightedMicros: weighted * 1e6,
  wonMicros: won * 1e6,
  overdueOpenMicros: overdueOpen * 1e6,
  manualCommitMicros: null,
  byOwner: [],
});

describe('ForecastProjection', () => {
  it('draws every quarter as stacked won, weighted and unweighted bars', () => {
    projection.result = {
      data: { periods: [period('Q4 2026', 73_000_000, 39_100_000, 0), period('Q1 2027', 10_000_000, 4_000_000, 0)] },
      isLoading: false,
      isError: false,
    };
    render(<ForecastProjection />);
    expect(screen.getByRole('group', { name: /projection by quarter/i })).toBeTruthy();
    const table = screen.getAllByRole('table').find((t) => within(t).queryByText('Unweighted'))!;
    expect(within(table).getByText('Q1 2027')).toBeTruthy();
    expect(screen.queryByText(/stage win-probability, by close-date quarter/)).toBeNull();
    expect(screen.queryByText(/past its close date/)).toBeNull();
  });

  it('says when the selected quarter’s open pipeline includes a close date that already passed', () => {
    projection.result = {
      data: {
        periods: [
          period('Q4 2026', 73_000_000, 39_100_000, 0, 73_000_000),
          period('Q1 2027', 10_000_000, 4_000_000, 0, 0),
        ],
      },
      isLoading: false,
      isError: false,
    };
    render(<ForecastProjection />);
    expect(
      screen.getByText('Q4 2026 open pipeline includes R$73000000 past its close date.'),
    ).toBeTruthy();
  });
});
