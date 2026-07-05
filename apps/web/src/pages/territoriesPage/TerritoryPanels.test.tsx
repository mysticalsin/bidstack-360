// WHY this test exists: Icon's PATHS map is typed Record<string, JSX.Element>,
// so a nonexistent icon name still typechecks and <Icon> silently renders
// null. CountryDetailPanel shipped exactly that bug — name="activity" (never
// registered) left the "Global Pipeline Share" metric with an invisible icon
// in both themes. This pins the row to a REAL registered glyph: it fails if
// the name ever drifts back to an unregistered icon.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TerritoryAnalyticsItem } from '@/hooks/useTerritories';

import { CountryDetailPanel } from './TerritoryPanels';

// framer-motion's layout machinery is irrelevant here — render plain DOM.
vi.mock('framer-motion', () => ({
  motion: new Proxy(
    {},
    {
      get:
        () =>
        ({ children, ...rest }: { children?: React.ReactNode }) => {
          const {
            layout: _l,
            whileHover: _wh,
            transition: _tr,
            ...domProps
          } = rest as Record<string, unknown>;
          return <div {...domProps}>{children}</div>;
        },
    },
  ),
}));

const FR: TerritoryAnalyticsItem = {
  countryCode: 'FR',
  countryCodeA3: 'FRA',
  opportunityCount: 4,
  totalValueMicros: 100_000_000_000,
  avgProbability: 40,
  territories: ['EMEA South'],
  ownerNames: ['Rita Kone'],
};

afterEach(cleanup);

describe('CountryDetailPanel global pipeline share row', () => {
  it('renders a registered SVG glyph next to the share label (not a silent null icon)', () => {
    render(
      <CountryDetailPanel
        selected={FR}
        formatMoneyMicros={(micros) => `€${micros / 1_000_000}`}
        globalTotals={{ totalValueMicros: 400_000_000_000 }}
        onClear={vi.fn()}
      />,
    );

    const label = screen.getByText('Global Pipeline Share');
    // <Icon> returns null for unregistered names — an svg must actually exist.
    expect(label.querySelector('svg')).not.toBeNull();
    // And the computed share renders alongside it (100 of 400 → 25.0%).
    expect(screen.getByText('25.0%')).toBeDefined();
  });
});
