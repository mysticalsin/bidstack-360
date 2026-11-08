// Opportunities do not store a currency. The map scale counts opportunities.
// Hover amounts say "unspecified". A display-currency conversion, or a
// currencyKnown flag that turned the same micros into euros, invented a forecast.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useCurrencyStore } from '@/stores/currency';
import type { TerritoryAnalyticsItem } from '@/hooks/useTerritories';
import { WorldMap } from './WorldMap';

// react-simple-maps pulls a remote topojson over the network and does heavy SVG
// work we don't need here — the legend under test renders outside <Geographies>.
vi.mock('react-simple-maps', () => ({
  ComposableMap: ({ children }: { children?: React.ReactNode }) => <svg>{children}</svg>,
  Geographies: () => null,
  Geography: () => null,
  ZoomableGroup: ({ children }: { children?: React.ReactNode }) => <g>{children}</g>,
  Graticule: () => null,
  Marker: ({ children }: { children?: React.ReactNode }) => <g>{children}</g>,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, unknown>) => {
      if (!values) return fallback;
      return fallback.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => String(values[k] ?? ''));
    },
  }),
}));

const item: TerritoryAnalyticsItem = {
  countryCode: 'FR',
  countryCodeA3: 'FRA',
  opportunityCount: 3,
  totalValueMicros: 1_000_000_000_000,
  avgProbability: 60,
  territories: ['EMEA'],
  ownerNames: ['Alex'],
};

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  // Seed a deterministic EUR→USD = 2.0 rate and select USD as display currency.
  useCurrencyStore.setState({
    currency: 'USD',
    rates: { base: 'EUR', rates: { USD: 2 }, date: '2026-01-01' },
  });
});

describe('WorldMap currency display', () => {
  it('does not draw a converted currency on the opportunity scale', () => {
    // Why: the scale counts opportunities. Treating the micros as euros and
    // converting them into the header currency invented a dollar pipeline.
    render(<WorldMap data={[item]} />);
    expect(screen.queryByText(/\$2M/)).toBeNull();
    expect(screen.queryByText(/€1M/)).toBeNull();
    expect(screen.getByText(/number of opportunities/)).toBeTruthy();
  });
});
