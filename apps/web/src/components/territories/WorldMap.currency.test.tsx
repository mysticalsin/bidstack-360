// The map stores euros. A USD selector must not relabel that figure as dollars.
// WHY: multiplying by a cached rate and printing $2M claims a conversion Tony
// has not approved. Fails if the legend shows a dollar amount.
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
  totalValueMicros: 1_000_000_000_000, // €1,000,000 at rest
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
  it('keeps the pipeline legend in euros when the selector is USD', () => {
    render(<WorldMap data={[item]} />);

    // €1,000,000 stays €1M. The loaded USD rate of 2 must not print $2M.
    expect(screen.getByText(/€1M EUR/)).toBeDefined();
    expect(screen.getAllByText(/not converted to USD/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/\$2M/)).toBeNull();
  });
});
