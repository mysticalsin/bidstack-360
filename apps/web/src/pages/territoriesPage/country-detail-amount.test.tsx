import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TerritoryAnalyticsItem } from '@/hooks/useTerritories';

import { countryDetailAmount } from './country-detail-amount';
import { CountryDetailPanel } from './TerritoryPanels';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
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

describe('territory country detail amount under demo data', () => {
  afterEach(() => {
    cleanup();
  });

  it('does not price a selected country pipeline of 61520 as euros', () => {
    // WHY: the country panel sums opportunity valueMicros. Those rows do not
    // store a currency. Demo synthetic pipeline was sent through an EUR source,
    // so a selected country of 61520 units looked like a euro forecast. The
    // figure stays 61520 and the panel does not name EUR. The share still
    // scales to the global total.
    const formatMoneyMicros = vi.fn((micros: number) => `EUR ${micros}`);

    render(
      <CountryDetailPanel
        selected={FRANCE}
        formatMoneyMicros={formatMoneyMicros}
        globalTotals={{ totalValueMicros: UNITS_61520_MICROS * 2 }}
        onClear={() => undefined}
      />,
    );

    const pipeline = screen.getByText('Pipeline').parentElement;
    const text = pipeline?.textContent ?? '';
    expect(text).not.toMatch(/EUR|€/);
    expect(digits(text)).toBe('61520');
    expect(formatMoneyMicros).not.toHaveBeenCalled();
    expect(screen.getByText('50.0%')).toBeTruthy();
  });

  it('does not invent a euro zero when the micros are not a safe integer', () => {
    // WHY: a country total that is not an integer micros value is not an
    // amount. It must not fall through to an EUR zero.
    expect(countryDetailAmount(Number.NaN)).toBe('Not a number');
    expect(countryDetailAmount(1.5)).toBe('Not a number');
    expect(countryDetailAmount(Number.NaN)).not.toMatch(/EUR|€/);
  });
});
