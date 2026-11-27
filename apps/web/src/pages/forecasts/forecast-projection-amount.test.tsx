import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ForecastProjection } from './ForecastProjection';
import { forecastProjectionAmount } from './forecast-projection-amount';

const projection = vi.hoisted(() => ({
  result: { data: undefined as unknown, isLoading: false, isError: false, error: null as Error | null, refetch: vi.fn() },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}));

vi.mock('@/hooks/useForecasts', () => ({
  useForecastProjection: () => projection.result,
}));

vi.mock('@/hooks/useFormatMoney', () => ({
  useFormatMoney: () => ({
    formatMoneyMicros: (micros: number) => `€${(micros / 1_000_000).toLocaleString('en-US')}`,
  }),
}));

const UNITS_61520_MICROS = 61_520_000_000;

function digits(text: string): string {
  return text.replace(/\D/g, '');
}

function weightedFigure(): string {
  const labels = screen.getAllByText('Weighted');
  for (const label of labels) {
    const card = label.closest('div.rounded-lg');
    const figure = card?.querySelector('.text-lg')?.textContent;
    if (figure) return figure;
  }
  return '';
}

describe('forecast projection under demo data', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('does not price a weighted projection of 61520 as euros', () => {
    // WHY: the weighted tile prints summed valueMicros as euros. The sum does
    // not carry a currency. Demo synthetic data sent 61520 units through an
    // EUR formatter, so Weighted read as a euro forecast. The figure stays
    // 61520 and does not name EUR. The manual commit badge, the open tile,
    // the won tile, and the owner columns stay on their own formatters.
    projection.result = {
      data: {
        currency: 'EUR',
        generatedAt: '2026-08-01T00:00:00.000Z',
        periods: [
          {
            period: '2026-Q3',
            label: 'Q3 2026',
            openMicros: 1_000_000,
            weightedMicros: UNITS_61520_MICROS,
            wonMicros: 0,
            manualCommitMicros: null,
            byOwner: [],
          },
        ],
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    };

    render(<ForecastProjection />);

    const figure = weightedFigure();
    expect(figure).not.toMatch(/EUR|€/);
    expect(digits(figure)).toBe('61520');
  });

  it('does not invent a euro zero when the micros are not a safe integer', () => {
    // WHY: a weighted sum that is not an integer micros value is not an amount.
    // It must not fall through to an EUR zero.
    expect(forecastProjectionAmount(Number.NaN)).toBe('Not a number');
    expect(forecastProjectionAmount(1.5)).toBe('Not a number');
    expect(forecastProjectionAmount('nope')).toBe('Not a number');
    expect(forecastProjectionAmount(Number.NaN)).not.toMatch(/EUR|€/);
  });
});
