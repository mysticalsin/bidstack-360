import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ForecastProjection } from './ForecastProjection';

const projection = vi.hoisted(() => ({
  result: { data: undefined as unknown, isLoading: false, isError: false },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock('@/hooks/useForecasts', () => ({ useForecastProjection: () => projection.result }));
vi.mock('@/hooks/useFormatMoney', () => ({
  useFormatMoney: () => ({ formatMoneyMicros: (m: number) => `R$${m / 1e6}` }),
}));

afterEach(cleanup);

function digits(text: string): string {
  return text.replace(/\D/g, '');
}

describe('forecast chart total under demo data', () => {
  it('keeps a weighted forecast of 61520 out of the open-plus-won total', () => {
    // WHY: demo bids do not store a currency. The quarter chart stacked closed
    // won, the weighted forecast, and the rest of open pipeline, then announced
    // that sum as the total. A 61520 weighted forecast sat inside a 120000
    // gross book and read as the forecast. The column total is the weighted
    // figure. Closed won stays visible and is not added. The figure is not euros.
    projection.result = {
      data: {
        periods: [
          {
            period: '2026-Q4',
            label: 'Q4 2026',
            openMicros: 0,
            weightedMicros: 0,
            wonMicros: 0,
            manualCommitMicros: null,
            byOwner: [],
          },
          {
            period: '2027-Q1',
            label: 'Q1 2027',
            openMicros: 100_000 * 1_000_000,
            weightedMicros: 61_520 * 1_000_000,
            wonMicros: 20_000 * 1_000_000,
            manualCommitMicros: null,
            byOwner: [],
          },
        ],
      },
      isLoading: false,
      isError: false,
    };

    render(<ForecastProjection />);

    const chart = screen.getByRole('img', { name: /in total/i });
    const summary = chart.getAttribute('aria-label') ?? '';
    const announced = summary.match(/(\S+)\s+in total/)?.[1] ?? '';
    expect(summary).not.toMatch(/EUR|€/);
    expect(digits(announced)).toBe('61520');

    const table = screen.getByRole('table', { name: /projection by quarter/i });
    const row = within(table).getByRole('row', { name: /Q1 2027/ });
    const total = within(row).getAllByRole('cell').at(-1)?.textContent ?? '';
    expect(total).not.toMatch(/EUR|€/);
    expect(digits(total)).toBe('61520');
    expect(within(table).getByText('Closed won')).toBeTruthy();
    expect(screen.getByText(/column total is the weighted forecast/i)).toBeTruthy();
  });
});
