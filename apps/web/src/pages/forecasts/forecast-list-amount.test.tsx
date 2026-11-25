import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ForecastList } from './ForecastList';
import { forecastListAmount } from './forecast-list-amount';
import type { ForecastRow } from './forecastsConfig';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}));

const UNITS_61520_MICROS = 61_520_000_000;

function digits(text: string): string {
  return text.replace(/\D/g, '');
}

function rowOf61520(): ForecastRow {
  return {
    ownerId: 'owner-1',
    ownerName: 'Alex Example',
    period: '2026-Q2',
    pipeline: UNITS_61520_MICROS,
    bestCase: 0,
    commit: 0,
    closed: 0,
    ids: { pipeline: 'p1', best_case: undefined, commit: undefined, closed: undefined },
  };
}

describe('forecast list amounts under demo data', () => {
  afterEach(() => {
    cleanup();
  });

  it('does not price a forecast row of 61520 as euros', () => {
    // WHY: the list prints category amountMicros as euros. The row does not
    // carry a currency. Demo synthetic data sent 61520 units through an EUR
    // formatter, so the pipeline cell and the row total read as a euro
    // forecast. The figure stays 61520 and does not name EUR.
    const euro = (micros: number) => `€${(micros / 1_000_000).toLocaleString('en-US')}`;

    render(
      <ForecastList
        rows={[rowOf61520()]}
        isLoading={false}
        isError={false}
        onRetry={() => undefined}
        onNewForecast={() => undefined}
        onSaveCell={() => undefined}
        onDeleteRow={() => undefined}
        formatMoneyMicros={euro}
        canWrite
        readOnlyHint="read only"
      />,
    );

    const table = screen.getByRole('table', { name: /Revenue forecasts/i });
    const dataRow = within(table).getAllByRole('row')[1];
    if (!dataRow) throw new Error('missing forecast row');
    const cells = within(dataRow).getAllByRole('cell');
    const pipeline = within(cells[2]!).getByRole('button').textContent ?? '';
    const total = cells[6]?.textContent ?? '';
    expect(pipeline).not.toMatch(/EUR|€/);
    expect(digits(pipeline)).toBe('61520');
    expect(total).not.toMatch(/EUR|€/);
    expect(digits(total)).toBe('61520');

    const mobileTotal = screen.getByText(/Total:/).textContent ?? '';
    expect(mobileTotal).not.toMatch(/EUR|€/);
    expect(digits(mobileTotal)).toBe('61520');
  });

  it('does not invent a euro zero when the micros are not a safe integer', () => {
    // WHY: a cell total that is not an integer micros value is not an amount.
    // It must not fall through to an EUR zero.
    expect(forecastListAmount(Number.NaN)).toBe('Not a number');
    expect(forecastListAmount(1.5)).toBe('Not a number');
    expect(forecastListAmount('nope')).toBe('Not a number');
    expect(forecastListAmount(Number.NaN)).not.toMatch(/EUR|€/);
  });
});
