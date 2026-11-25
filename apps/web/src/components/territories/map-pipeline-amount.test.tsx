import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useCurrencyStore } from '@/stores/currency';
import type { TerritoryAnalyticsItem } from '@/hooks/useTerritories';

import { mapPipelineAmount } from './map-pipeline-amount';
import { WorldMap } from './WorldMap';

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
    t: (_key: string, fallback: string) => fallback,
  }),
}));

const UNITS_61520_MICROS = 61_520_000_000;

const FRANCE: TerritoryAnalyticsItem = {
  countryCode: 'FR',
  countryCodeA3: 'FRA',
  opportunityCount: 1,
  totalValueMicros: UNITS_61520_MICROS,
  avgProbability: 40,
  territories: ['EMEA South'],
  ownerNames: ['Ada Owner'],
};

function digits(text: string | null | undefined): string {
  return (text ?? '').replace(/\D/g, '');
}

describe('territory map pipeline amount under demo data', () => {
  afterEach(() => {
    cleanup();
  });

  it('does not price a map pipeline of 61520 as euros', () => {
    // WHY: the map legend prints opportunity valueMicros. Those rows do not
    // store a currency. Demo synthetic pipeline was sent through an EUR
    // source, so a country of 61520 units looked like a euro forecast. The
    // top legend figure stays 61520 and does not name EUR. The color scale
    // is unchanged.
    useCurrencyStore.setState({ currency: 'EUR', rates: null });

    render(<WorldMap data={[FRANCE]} />);

    const legend = screen.getByText('Pipeline').parentElement;
    const labels = legend?.querySelectorAll('span.tabular-nums');
    const top = labels?.[labels.length - 1]?.textContent ?? '';
    expect(top).not.toMatch(/EUR|€/);
    expect(digits(top)).toBe('61520');
    expect(legend?.textContent ?? '').not.toMatch(/EUR|€/);
  });

  it('does not invent a euro zero when the micros are not a safe integer', () => {
    // WHY: a map label that is not an integer micros value is not an amount.
    // It must not fall through to an EUR zero. The color scale is separate.
    expect(mapPipelineAmount(Number.NaN)).toBe('Not a number');
    expect(mapPipelineAmount(1.5)).toBe('Not a number');
    expect(mapPipelineAmount(Number.NaN)).not.toMatch(/EUR|€/);
  });
});
