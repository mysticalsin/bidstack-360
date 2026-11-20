// Regression: the world map's legend/tooltip/aria-label money figures must
// track the user's selected display currency (via useCurrencyStore), not a
// hardcoded EUR. WHY: WorldMap is shared by Territories + Sector View, where
// every other money surface already converts — the map showing '€1M' while the
// KPI tiles show '$2M' for the same portfolio is a silently-wrong figure to a
// bid director, not a cosmetic mismatch. Fails if the component reverts to the
// module-level formatMoneyMicros with a hardcoded output currency.
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
  it('renders the pipeline legend in the user-selected currency, converted from EUR', () => {
    render(<WorldMap data={[item]} />);

    // maxValue = €1,000,000 → at USD rate 2.0 the top legend bracket is $2M.
    // The pre-fix code hardcoded 'EUR' and would render '€1M' regardless.
    expect(screen.getByText(/\$2M/)).toBeDefined();
    expect(screen.queryByText(/€1M/)).toBeNull();
  });
});
