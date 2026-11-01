import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Forecast } from '@bidstack/shared';

import { ForecastsPage } from './ForecastsPage';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}));

const forecasts = vi.hoisted(() => ({
  data: { items: [] as Forecast[] },
  isLoading: false,
}));

vi.mock('@/hooks/useForecasts', () => ({
  useForecasts: () => forecasts,
  useForecastProjection: () => ({ data: undefined, isLoading: false, isError: false }),
  useCreateForecast: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteForecast: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@/hooks/useUsers', () => ({
  useUsers: () => ({ data: [], isLoading: false }),
}));

function forecast(amountMicros: string, currency = 'XXX'): Forecast {
  return {
    id: '6b1b3a2e-1c4d-4e5f-8a9b-0c1d2e3f4a5b',
    orgId: '6b1b3a2e-1c4d-4e5f-8a9b-0c1d2e3f4a5c',
    ownerId: '6b1b3a2e-1c4d-4e5f-8a9b-0c1d2e3f4a5d',
    ownerName: 'Ada',
    period: '2026-07',
    category: 'commit',
    amountMicros,
    currency,
    note: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('ForecastsPage amounts', () => {
  afterEach(() => {
    cleanup();
    forecasts.data = { items: [] };
  });

  it('prints a commit with no currency from the micros integer', () => {
    // WHY: a bare number next to the display currency reads as that currency,
    // and a unit count past the safe integer is one unit low.
    const micros = (9007199254740993n * 1_000_000n).toString();
    forecasts.data = { items: [forecast(micros)] };
    render(<ForecastsPage />);
    expect(screen.getAllByText('9,007,199,254,740,993 unspecified').length).toBeGreaterThan(0);
    expect(screen.queryByText(/9,007,199,254,740,992/)).toBeNull();
    expect(screen.queryByText('$')).toBeNull();
  });

  it('prints a USD commit in dollars and leaves it out of the unspecified headline', () => {
    // WHY: the grid labeled every cell unspecified, so a stored dollar amount disappeared into that word.
    forecasts.data = {
      items: [forecast('1500000000000', 'USD')],
    };
    render(<ForecastsPage />);
    expect(screen.getAllByText('$1.5M').length).toBeGreaterThan(0);
    expect(screen.getByText('Commit · USD')).toBeTruthy();
    expect(screen.getAllByText('0 unspecified').length).toBeGreaterThan(0);
  });
});
