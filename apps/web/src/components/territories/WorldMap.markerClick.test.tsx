// Regression: clicking a country's pulse marker on the Global Opportunity Map
// must reliably reach that country, even for large countries (e.g. France)
// whose geography <path> can render above the marker at the exact pixel the
// marker is drawn at. WHY: the marker's visible circles are
// pointer-events:none (so they never block the geography layer's own hover
// state), which means a click only reaches onCountryClick if the marker also
// carries a real, pointer-events:all hit target above the geography layer —
// without it the click silently falls through to whatever <path> happens to
// occupy that pixel and does nothing. Fails if that hit target's pointer
// events or click handler are removed.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TerritoryAnalyticsItem } from '@/hooks/useTerritories';
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
    t: (_key: string, fallback: string, values?: Record<string, unknown>) => {
      if (!values) return fallback;
      return fallback.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => String(values[k] ?? ''));
    },
  }),
}));

const france: TerritoryAnalyticsItem = {
  countryCode: 'FR',
  countryCodeA3: 'FRA',
  opportunityCount: 4,
  totalValueMicros: 5_000_000_000_000, // largest bubble on the map
  avgProbability: 55,
  territories: ['EMEA'],
  ownerNames: ['Alex'],
};

const uk: TerritoryAnalyticsItem = {
  countryCode: 'GB',
  countryCodeA3: 'GBR',
  opportunityCount: 1,
  totalValueMicros: 100_000_000, // small bubble — already worked before the fix
  avgProbability: 40,
  territories: ['EMEA'],
  ownerNames: ['Sam'],
};

afterEach(() => {
  cleanup();
});

describe('WorldMap marker click routing', () => {
  it('routes a click on the France marker to onCountryClick with the France item', () => {
    const onCountryClick = vi.fn();
    render(<WorldMap data={[france, uk]} onCountryClick={onCountryClick} />);

    fireEvent.click(screen.getByTestId('marker-hit-FR'));

    expect(onCountryClick).toHaveBeenCalledTimes(1);
    expect(onCountryClick).toHaveBeenCalledWith(france);
  });

  it('keeps each country marker independently clickable (large bubble does not swallow the small one)', () => {
    const onCountryClick = vi.fn();
    render(<WorldMap data={[france, uk]} onCountryClick={onCountryClick} />);

    fireEvent.click(screen.getByTestId('marker-hit-GB'));

    expect(onCountryClick).toHaveBeenCalledTimes(1);
    expect(onCountryClick).toHaveBeenCalledWith(uk);
  });

  it('gives the marker hit target real pointer events so it is not silently inert', () => {
    render(<WorldMap data={[france]} onCountryClick={vi.fn()} />);

    const hitTarget = screen.getByTestId('marker-hit-FR');
    // Pre-fix, both marker circles were pointer-events:none, so a click at the
    // marker's center always fell through to the geography layer beneath it.
    expect(hitTarget.getAttribute('pointer-events')).toBe('all');
  });
});
