import { describe, expect, it } from 'vitest';

import type { Forecast } from '@bidstack/shared';

import { buildChartData, groupForecasts, sumForecastMicros } from './forecastsConfig';

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
    expect(buildChartData(rows)[0]?.commit).toBe(micros);
  });
});
