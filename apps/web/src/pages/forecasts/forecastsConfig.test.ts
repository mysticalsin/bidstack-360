import { describe, expect, it } from 'vitest';

import type { Forecast } from '@bidstack/shared';

import {
  buildChartData,
  formatForecastAmount,
  forecastRowTotalCurrency,
  groupForecasts,
  sumForecastMicros,
} from './forecastsConfig';

function forecast(overrides: Partial<Forecast>): Forecast {
  return {
    id: '6b1b3a2e-1c4d-4e5f-8a9b-0c1d2e3f4a5b',
    orgId: '6b1b3a2e-1c4d-4e5f-8a9b-0c1d2e3f4a5c',
    ownerId: '6b1b3a2e-1c4d-4e5f-8a9b-0c1d2e3f4a5d',
    ownerName: 'Ada',
    period: '2026-Q2',
    category: 'commit',
    amountMicros: '0',
    currency: 'XXX',
    note: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('forecast grouping', () => {
  it('keeps a large commit as the micros string', () => {
    // WHY: adding the amount as a number moved this commit off the cent.
    const micros = '8598204328457184962';
    const rows = groupForecasts([forecast({ amountMicros: micros })]);
    expect(rows[0]?.commit).toBe(micros);
    expect(sumForecastMicros(rows[0]!.pipeline, rows[0]!.commit).toString()).toBe(micros);
    expect(rows[0]?.currencies.commit).toBe('XXX');
    expect(buildChartData(rows)[0]?.commit).toBe(micros);
    expect(formatForecastAmount(micros, 'XXX')).toContain('unspecified');
    expect(formatForecastAmount(micros, 'EUR')).toContain('unspecified');
  });

  it('prints a recorded currency from the micros and leaves it out of the unspecified chart', () => {
    // WHY: the cell used to say unspecified even when the row stored USD.
    const micros = (9007199254740993n * 1_000_000n).toString();
    const rows = groupForecasts([
      forecast({ amountMicros: micros, currency: 'USD' }),
      forecast({
        id: '6b1b3a2e-1c4d-4e5f-8a9b-0c1d2e3f4a5e',
        category: 'pipeline',
        amountMicros: '1000000',
        currency: 'XXX',
      }),
    ]);
    expect(rows[0]?.currencies.commit).toBe('USD');
    expect(forecastRowTotalCurrency(rows[0]!)).toBe('mixed');
    expect(buildChartData(rows)[0]?.commit).toBe('0');
    expect(buildChartData(rows)[0]?.pipeline).toBe('1000000');
    const label = formatForecastAmount(micros, 'usd');
    expect(label).toContain('9,007,199,254,740,993');
    expect(label).toContain('$');
    expect(label).not.toContain('unspecified');
    expect(label).not.toContain('9,007,199,254,740,992');
  });
});
