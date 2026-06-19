import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement, ReactNode } from 'react';

import { TerritoriesPage } from './TerritoriesPage';
import {
  useTerritories,
  useLeadRoutingRules,
  useTerritoryAnalytics,
  useTerritorySegments,
} from '@/hooks/useTerritories';

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

// Mock the React Simple Maps SVG components so tests don't throw during geography fetching or mapping
vi.mock('react-simple-maps', () => ({
  ComposableMap: ({ children }: MapChildrenProps) => (
    <svg data-testid="composable-map">{children}</svg>
  ),
  Geographies: ({ children }: GeographiesProps) => children({ geographies: [] }),
  Geography: () => <path data-testid="geography" />,
  ZoomableGroup: ({ children }: MapChildrenProps) => <g data-testid="zoomable-group">{children}</g>,
  Graticule: () => <path data-testid="graticule" />,
  Marker: ({ children }: MapChildrenProps) => <g data-testid="marker">{children}</g>,
}));

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

function mockTerritoryHooks(
  tValue: Partial<ReturnType<typeof useTerritories>>,
  rValue: Partial<ReturnType<typeof useLeadRoutingRules>>,
  aValue: Partial<ReturnType<typeof useTerritoryAnalytics>>,
  sValue: Partial<ReturnType<typeof useTerritorySegments>> = {
    data: undefined,
    isLoading: false,
    isError: false,
  },
) {
  vi.mocked(useTerritories).mockReturnValue(tValue as ReturnType<typeof useTerritories>);
  vi.mocked(useLeadRoutingRules).mockReturnValue(rValue as ReturnType<typeof useLeadRoutingRules>);
  vi.mocked(useTerritoryAnalytics).mockReturnValue(
    aValue as ReturnType<typeof useTerritoryAnalytics>,
  );
  vi.mocked(useTerritorySegments).mockReturnValue(
    sValue as ReturnType<typeof useTerritorySegments>,
  );
}

function renderWithProviders(ui: ReactElement) {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('TerritoriesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders a loading skeleton when data is loading', () => {
    mockTerritoryHooks(
      { data: undefined, isLoading: true, isError: false },
      { data: undefined, isLoading: true, isError: false },
      { data: undefined, isLoading: true, isError: false },
    );

    renderWithProviders(<TerritoriesPage />);

    expect(screen.queryByText('Total Pipeline')).toBeNull();
  });

  it('renders KPI metrics and listings when data loads successfully', () => {
    mockTerritoryHooks(
      {
        data: {
          items: [
            {
              id: 't-1',
              orgId: 'org-1',
              name: 'Europe Central',
              region: 'EMEA',
              countryCodes: ['DE', 'FR'],
              postalCodes: [],
              active: true,
              ownerId: 'owner-1',
              ownerName: 'Alice Dev',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          ],
        },
        isLoading: false,
        isError: false,
      },
      {
        data: {
          items: [
            {
              id: 'r-1',
              orgId: 'org-1',
              name: 'Germany Auto Assign',
              priority: 1,
              criteria: { countryCode: 'DE' },
              active: true,
              assignToUserId: null,
              assignToTerritoryId: 't-1',
              roundRobinTeam: [],
              roundRobinIndex: 0,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          ],
        },
        isLoading: false,
        isError: false,
      },
      {
        data: {
          totals: {
            totalOpportunities: 42,
            totalCountries: 5,
            totalValueMicros: 15000000000,
            avgProbability: 75,
          },
          items: [
            {
              countryCode: 'FR',
              countryCodeA3: 'FRA',
              opportunityCount: 2,
              totalValueMicros: 5000000000,
              avgProbability: 80,
              territories: ['Europe Central'],
              ownerNames: ['Alice Dev'],
            },
          ],
        },
        isLoading: false,
        isError: false,
      },
    );

    renderWithProviders(<TerritoriesPage />);

    // Check header and KPI values
    expect(screen.getByRole('heading', { name: 'Territories', level: 1 })).toBeTruthy();
    expect(screen.getByText('$15K')).toBeTruthy(); // 15,000,000,000 micros = 15,000 EUR, converted to USD and compacted
    expect(screen.getByText('75%')).toBeTruthy();

    // Check list entries
    expect(screen.getByText('Europe Central')).toBeTruthy();
    expect(screen.getByText('Germany Auto Assign')).toBeTruthy();
  });
});
