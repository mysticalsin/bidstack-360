// The map legend labels opportunity valueMicros. Those rows do not store a
// currency. WHY: a selected display currency and a cached EUR to USD rate must
// not turn 1,000,000 units into $2M. Fails if the legend borrows EUR again.
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
  totalValueMicros: 1_000_000_000_000, // 1,000,000 units at rest
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
  it('does not convert a country pipeline into the selected currency', () => {
    render(<WorldMap data={[item]} />);

    // 1,000,000 units. A USD selector and an EUR to USD rate of 2 must not
    // print $2M or a euro symbol. The color scale is not asserted here.
    const legend = screen.getByText('Pipeline').parentElement;
    const labels = legend?.querySelectorAll('span.tabular-nums');
    const top = labels?.[labels.length - 1]?.textContent ?? '';
    expect(top).not.toMatch(/EUR|€|\$/);
    expect(top.replace(/\D/g, '')).toBe('1000000');
  });
});
