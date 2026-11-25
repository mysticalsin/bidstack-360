import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement, ReactNode } from 'react';

import { TerritoriesPage } from '@/pages/TerritoriesPage';
import { territoryTotalAmount } from './territory-total-amount';
import {
  useLeadRoutingRules,
  useTerritories,
  useTerritoryAnalytics,
  useTerritorySegments,
} from '@/hooks/useTerritories';
import { useCurrencyStore } from '@/stores/currency';

type MapChildrenProps = { children?: ReactNode };
type GeographiesProps = { children: (args: { geographies: unknown[] }) => ReactNode };

vi.mock('@/hooks/useTerritories', () => ({
  useTerritories: vi.fn(),
  useLeadRoutingRules: vi.fn(),
  useTerritoryAnalytics: vi.fn(),
  useTerritorySegments: vi.fn(),
  useCreateTerritory: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useUpdateTerritory: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useDeleteTerritory: vi.fn(() => ({ mutate: vi.fn() })),
  useCreateLeadRoutingRule: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useUpdateLeadRoutingRule: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useDeleteLeadRoutingRule: vi.fn(() => ({ mutate: vi.fn() })),
}));

vi.mock('@/hooks/useCapabilities', () => ({
  useHasPermission: vi.fn(() => true),
}));

vi.mock('react-simple-maps', () => ({
  ComposableMap: ({ children }: MapChildrenProps) => <svg>{children}</svg>,
  Geographies: ({ children }: GeographiesProps) => children({ geographies: [] }),
  Geography: () => null,
  ZoomableGroup: ({ children }: MapChildrenProps) => <g>{children}</g>,
  Graticule: () => null,
  Marker: ({ children }: MapChildrenProps) => <g>{children}</g>,
}));

const UNITS_61520_MICROS = 61_520_000_000;

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

function digits(text: string | null | undefined): string {
  return (text ?? '').replace(/\D/g, '');
}

function renderPage() {
  const ui: ReactElement = <TerritoriesPage />;
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('territory total pipeline amount under demo data', () => {
  afterEach(() => {
    cleanup();
  });

  it('does not price a total pipeline of 61520 as euros', () => {
    // WHY: the territories total sums opportunity valueMicros. Those rows do
    // not store a currency. Demo synthetic pipeline was sent through an EUR
    // source, so a book of 61520 units looked like a euro forecast. The figure
    // stays 61520 and the tile does not name EUR. The map scale is unchanged.
    useCurrencyStore.setState({ currency: 'EUR', rates: null });
    vi.mocked(useTerritories).mockReturnValue({
      data: { items: [] },
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useTerritories>);
    vi.mocked(useLeadRoutingRules).mockReturnValue({
      data: { items: [] },
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useLeadRoutingRules>);
    vi.mocked(useTerritoryAnalytics).mockReturnValue({
      data: {
        totals: {
          totalOpportunities: 1,
          totalCountries: 1,
          totalValueMicros: UNITS_61520_MICROS,
          avgProbability: 40,
        },
        items: [],
      },
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useTerritoryAnalytics>);
    vi.mocked(useTerritorySegments).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useTerritorySegments>);

    renderPage();

    const tile = screen.getByText('Total Pipeline').parentElement;
    const text = tile?.textContent ?? '';
    expect(text).not.toMatch(/EUR|€/);
    expect(digits(text)).toBe('61520');
  });

  it('does not invent a euro zero when the micros are not a safe integer', () => {
    // WHY: a territory total that is not an integer micros value is not an
    // amount. It must not fall through to an EUR zero.
    expect(territoryTotalAmount(Number.NaN)).toBe('Not a number');
    expect(territoryTotalAmount(1.5)).toBe('Not a number');
    expect(territoryTotalAmount(Number.NaN)).not.toMatch(/EUR|€/);
  });
});
