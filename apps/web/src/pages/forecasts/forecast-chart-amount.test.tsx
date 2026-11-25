import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ForecastChart } from './ForecastChart';
import { forecastChartAmount } from './forecast-chart-amount';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}));

const UNITS_61520_MICROS = 61_520_000_000;

function digits(text: string): string {
  return text.replace(/\D/g, '');
}

describe('forecast chart amounts under demo data', () => {
  afterEach(() => {
    cleanup();
  });

  it('does not price a forecast bar of 61520 as euros', () => {
    // WHY: the chart sums category amountMicros and prints that integer as
    // euros. The summed bar does not carry a currency. Demo synthetic data
    // sent 61520 units through an EUR formatter, so the bar read as a euro
    // forecast. The figure stays 61520 and does not name EUR. The bar still
    // scales to the largest period.
    const euro = (micros: number) => `€${(micros / 1_000_000).toLocaleString('en-US')}`;

    render(
      <ForecastChart
        chartData={[
          {
            period: '2026-Q2',
            pipeline: UNITS_61520_MICROS,
            bestCase: 0,
            commit: 0,
            closed: 0,
          },
        ]}
        maxTotal={UNITS_61520_MICROS}
        formatMoneyMicros={euro}
      />,
    );

    const bar = screen.getByRole('img', { name: /2026-Q2/ });
    const label = bar.getAttribute('aria-label') ?? '';
    const amount = label.split(': ')[1] ?? '';
    expect(label).not.toMatch(/EUR|€/);
    expect(digits(amount)).toBe('61520');
    expect(bar.getAttribute('style')).toContain('height: 100%');

    const pipeline = document.querySelector('[title^="Pipeline:"]');
    const title = pipeline?.getAttribute('title') ?? '';
    expect(title).not.toMatch(/EUR|€/);
    expect(digits(title.split(': ')[1] ?? '')).toBe('61520');
  });

  it('does not invent a euro zero when the micros are not a safe integer', () => {
    // WHY: a bar total that is not an integer micros value is not an amount.
    // It must not fall through to an EUR zero. The bar scale stays on the
    // raw total.
    expect(forecastChartAmount(Number.NaN)).toBe('Not a number');
    expect(forecastChartAmount(1.5)).toBe('Not a number');
    expect(forecastChartAmount('nope')).toBe('Not a number');
    expect(forecastChartAmount(Number.NaN)).not.toMatch(/EUR|€/);
  });
});
