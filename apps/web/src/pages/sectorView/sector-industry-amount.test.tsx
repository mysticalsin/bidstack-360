import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import SectorViewPage from '@/pages/SectorViewPage';
import { useSectorView, type SectorViewResponse } from '@/hooks/useSectorView';
import { useTerritoryAnalytics, useTerritorySegments } from '@/hooks/useTerritories';
import { useCurrencyStore } from '@/stores/currency';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, opts?: Record<string, unknown>) => {
      if (!opts) return fallback;
      return fallback.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(opts[name] ?? ''));
    },
  }),
}));

vi.mock('@/hooks/useSectorView', () => ({ useSectorView: vi.fn() }));

vi.mock('@/hooks/useTerritories', () => ({
  useTerritoryAnalytics: vi.fn(),
  useTerritorySegments: vi.fn(),
}));

vi.mock('@/hooks/useOpportunityRows', () => ({
  useAllOpportunityRows: () => ({
    data: { items: [], complete: true },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));

vi.mock('@/components/territories/WorldMap', () => ({
  WorldMap: () => <div data-testid="world-map" />,
}));

const UNITS_61520_MICROS = 61_520_000_000;

const RESPONSE: SectorViewResponse = {
  generatedAt: '2026-06-26T00:00:00Z',
  totalAccounts: 1,
  classifiedAccounts: 1,
  dataQualityWarning: false,
  sectors: [
    {
      sector: 'healthcare',
      accountCount: 1,
      fteVolume: 10,
      coverage: { knownFteAccounts: 1, verifiedAccounts: 1, logoAccounts: 1 },
      countries: [{ countryCode: 'FR', accountCount: 1, fteVolume: 10 }],
      accounts: [],
    },
  ],
};

function digits(text: string): string {
  return text.replace(/\D/g, '');
}

describe('sector industry pipeline amount under demo data', () => {
  afterEach(() => {
    cleanup();
  });

  it('does not price an industry pipeline of 61520 as euros', () => {
    // WHY: sector industry bars sum opportunity valueMicros. Those rows do not
    // store a currency. Demo synthetic pipeline was sent through an EUR
    // source, so an industry of 61520 units looked like a euro forecast. The
    // figure stays 61520 and does not name EUR. The bar scale is unchanged.
    useCurrencyStore.setState({ currency: 'EUR', rates: null });
    vi.mocked(useSectorView).mockReturnValue({
      data: RESPONSE,
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as ReturnType<typeof useSectorView>);
    vi.mocked(useTerritoryAnalytics).mockReturnValue({
      data: { items: [] },
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useTerritoryAnalytics>);
    vi.mocked(useTerritorySegments).mockReturnValue({
      data: {
        dimension: 'industry',
        items: [
          {
            key: 'Pharma',
            label: 'Pharma',
            opportunityCount: 1,
            totalValueMicros: UNITS_61520_MICROS,
            avgProbability: 40,
            ownerNames: ['Ada Owner'],
          },
        ],
        totals: {
          totalSegments: 1,
          totalValueMicros: UNITS_61520_MICROS,
          totalOpportunities: 1,
          avgProbability: 40,
        },
      },
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useTerritorySegments>);

    render(
      <MemoryRouter>
        <SectorViewPage />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('tab', { name: 'By industry' }));

    const row = screen.getByText('Pharma').parentElement;
    const meta = row?.querySelector('.tabular-nums')?.textContent ?? '';
    expect(meta).not.toMatch(/EUR|€/);
    const valuePart = meta.split('·').pop() ?? '';
    expect(digits(valuePart)).toBe('61520');
  });
});
