import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ForecastList } from './ForecastList';
import { FORECAST_LIST_PAGE, forecastDetailsCaption } from './forecast-list-caption';
import type { ForecastRow } from './forecastsConfig';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, opts?: Record<string, unknown>) => {
      if (!opts) return fallback;
      return Object.entries(opts).reduce(
        (str, [k, v]) => str.replace(`{{${k}}}`, String(v)),
        fallback,
      );
    },
  }),
}));

function row(period: string): ForecastRow {
  return {
    ownerId: `owner-${period}`,
    ownerName: 'Alex Example',
    period,
    pipeline: 0,
    bestCase: 0,
    commit: 0,
    closed: 0,
    ids: { pipeline: undefined, best_case: undefined, commit: undefined, closed: undefined },
  };
}

function renderList(rows: ForecastRow[]) {
  return render(
    <ForecastList
      rows={rows}
      isLoading={false}
      isError={false}
      onRetry={() => undefined}
      onNewForecast={() => undefined}
      onSaveCell={() => undefined}
      onDeleteRow={() => undefined}
      formatMoneyMicros={(micros) => `€${micros / 1_000_000}`}
      canWrite
      readOnlyHint="read only"
    />,
  );
}

describe('forecast details caption on an empty manual book', () => {
  afterEach(() => {
    cleanup();
  });

  it('does not count the demo book as zero forecast groups', () => {
    // WHY: the sign-in demo writes bids and no manual forecast rows. Forecast
    // Details then printed "0 forecast groups". That zero reads as the forecast
    // itself. The projection above is the book. A count of zero groups is not
    // a forecast total.
    renderList([]);

    expect(screen.getByRole('heading', { name: 'Forecast Details' })).toBeTruthy();
    expect(screen.queryByText(/0 forecast groups/)).toBeNull();
    expect(screen.getByRole('heading', { name: 'No forecasts found' })).toBeTruthy();
  });

  it('keeps the group count when a manual forecast is on the page', () => {
    // WHY: the zero caption is only the empty book. A saved row is a real group
    // and the count stays.
    renderList([row('2026-Q1'), row('2027-Q1')]);

    expect(screen.getByText('2 forecast groups')).toBeTruthy();
  });
});

describe('forecastDetailsCaption', () => {
  it('omits a zero count and keeps a real count and a continued page', () => {
    // WHY: zero groups is not a forecast total. A saved row and a page that
    // dropped a later forecast still need their captions.
    expect(forecastDetailsCaption(0, false, FORECAST_LIST_PAGE)).toBeNull();
    expect(forecastDetailsCaption(2, false, FORECAST_LIST_PAGE)).toBe('2 forecast groups');
    expect(forecastDetailsCaption(4, true, FORECAST_LIST_PAGE)).toBe(
      `4 forecast groups in the latest ${FORECAST_LIST_PAGE}, not every forecast`,
    );
  });
});
