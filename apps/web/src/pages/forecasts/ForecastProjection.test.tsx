import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ForecastProjection } from './ForecastProjection';

const projection = vi.hoisted(() => ({ result: { data: undefined as unknown, isLoading: false, isError: false } }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, vars?: Record<string, string>) =>
      fallback.replace(/\{\{(\w+)\}\}/g, (_, name: string) => vars?.[name] ?? ''),
  }),
}));
vi.mock('@/hooks/useForecasts', () => ({ useForecastProjection: () => projection.result }));
vi.mock('@/hooks/useFormatMoney', () => ({
  useFormatMoney: () => ({ formatMoneyMicros: (m: number) => `R$${m / 1e6}` }),
}));

afterEach(cleanup);

const period = (label: string, open: number, weighted: number, won: number) => ({
  period: label,
  label,
  openMicros: open * 1e6,
  weightedMicros: weighted * 1e6,
  wonMicros: won * 1e6,
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
    // This quarter still has open pipeline, so the headline stays here.
    expect(openPipelineCard().textContent).toContain('R$73000000');
    expect(screen.queryByText(/Nothing closes in/)).toBeNull();
  });

  // Demo bids are dated 45 days out. From late Q4 that close date is next
  // quarter, so the current quarter is a real zero and the book is one tab
  // over. Opening on the zero reads as an empty forecast.
  it('opens on the next quarter when this quarter has no pipeline', () => {
    projection.result = {
      data: {
        periods: [
          period('Q4 2026', 0, 0, 0),
          period('Q1 2027', 6_200_000, 3_100_000, 620_000),
        ],
      },
      isLoading: false,
      isError: false,
    };
    render(<ForecastProjection />);
    expect(openPipelineCard().textContent).toContain('R$6200000');
    expect(screen.getByRole('tab', { name: 'Q1 2027' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('Nothing closes in Q4 2026. Next figures are in Q1 2027.')).toBeTruthy();
    // Period tabs are the way back to the empty quarter, so the hit target stays 44px.
    expect(screen.getByRole('tab', { name: 'Q4 2026' }).className).toContain('min-h-11');
  });

  it('keeps the empty quarter one click away', () => {
    projection.result = {
      data: {
        periods: [
          period('Q4 2026', 0, 0, 0),
          period('Q1 2027', 6_200_000, 3_100_000, 620_000),
        ],
      },
      isLoading: false,
      isError: false,
    };
    render(<ForecastProjection />);
    const emptyQuarter = screen.getByRole('tab', { name: 'Q4 2026' });
    fireEvent.mouseDown(emptyQuarter);
    fireEvent.click(emptyQuarter);
    expect(screen.getByRole('tab', { name: 'Q4 2026' }).getAttribute('aria-selected')).toBe('true');
    expect(openPipelineCard().textContent).toContain('R$0');
    expect(screen.getByText('Nothing closes in Q4 2026. Next figures are in Q1 2027.')).toBeTruthy();
  });
});

function openPipelineCard(): HTMLElement {
  const label = screen.getByText('Open pipeline');
  const card = label.closest('div.rounded-lg');
  if (!card) throw new Error('open pipeline card not found');
  return card;
}
