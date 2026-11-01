import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ForecastProjection } from './ForecastProjection';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}));

const projection = vi.hoisted(() => ({
  data: undefined as unknown,
  isLoading: false,
  isError: false,
  error: null as Error | null,
  refetch: vi.fn(),
}));

vi.mock('@/hooks/useForecasts', () => ({
  useForecastProjection: () => projection,
}));

afterEach(() => {
  cleanup();
  projection.data = undefined;
  projection.isLoading = false;
  projection.isError = false;
});

describe('ForecastProjection', () => {
  it('prints a weighted total from micros when the unit count no longer fits', () => {
    // WHY: compacting the unit number showed 9,007,199,254,740,992. The stored
    // weighted quarter is one unit higher.
    const micros = (9007199254740993n * 1_000_000n).toString();
    projection.data = {
      currency: 'XXX',
      generatedAt: '2026-07-01T00:00:00.000Z',
      periods: [
        {
          period: '2026-Q3',
          label: 'Q3 2026',
          openMicros: micros,
          weightedMicros: micros,
          wonMicros: '0',
          manualCommitMicros: null,
          byOwner: [],
        },
      ],
    };

    render(<ForecastProjection />);

    expect(screen.getAllByText('9,007,199,254,740,993 unspecified').length).toBeGreaterThan(0);
    expect(screen.queryByText(/9,007,199,254,740,992/)).toBeNull();
  });

  it('keeps an ordinary quarter compact', () => {
    projection.data = {
      currency: 'XXX',
      generatedAt: '2026-07-01T00:00:00.000Z',
      periods: [
        {
          period: '2026-Q3',
          label: 'Q3 2026',
          openMicros: '1500000000000',
          weightedMicros: '600000000000',
          wonMicros: '0',
          manualCommitMicros: '2500000000000',
          byOwner: [
            {
              ownerId: null,
              ownerName: 'Unassigned',
              openMicros: '1500000000000',
              weightedMicros: '600000000000',
              wonMicros: '0',
            },
          ],
        },
      ],
    };

    render(<ForecastProjection />);

    expect(screen.getAllByText('1.5M unspecified').length).toBeGreaterThan(0);
    expect(screen.getAllByText('600K unspecified').length).toBeGreaterThan(0);
    // WHY: the manual commit was a bare number, so it read as the display currency.
    expect(screen.getByText('Manual commit: 2.5M unspecified')).toBeTruthy();
  });
});
