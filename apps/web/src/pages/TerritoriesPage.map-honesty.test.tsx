// The territory map is the census of where the demo book sits. Until that
// read arrives, "No geographic data" is a map the page invented. A paused
// read and an idle unread read have no payload, and isLoading is false, so
// the empty state fires. An in-flight read keeps the skeleton and must not
// say the map is empty. A failed read with no payload stays on the error.
// A page that arrived empty still says "No geographic data". A loaded
// country still draws the map.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement, ReactNode } from 'react';

import { i18n } from '@/i18n';

import { TerritoriesPage } from './TerritoriesPage';
import {
  useTerritories,
  useLeadRoutingRules,
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

vi.mock('@/hooks/useCapabilities', () => ({ useHasPermission: vi.fn(() => true) }));

vi.mock('react-simple-maps', () => ({
  ComposableMap: ({ children }: MapChildrenProps) => (
    <svg data-testid="composable-map">{children}</svg>
  ),
  Geographies: ({ children }: GeographiesProps) => children({ geographies: [] }),
  Geography: () => <path data-testid="geography" />,
  ZoomableGroup: ({ children }: MapChildrenProps) => <g>{children}</g>,
  Graticule: () => <path />,
  Marker: ({ children }: MapChildrenProps) => <g>{children}</g>,
}));

const CHECKING = 'Checking the map. It has not arrived.';
const FAILED = 'Failed to load map data';
const EMPTY = 'No geographic data';
const DEMO_TERRITORY = 'Demo North';

const DEMO_COUNTRY = {
  countryCode: 'FR',
  countryCodeA3: 'FRA',
  opportunityCount: 2,
  totalValueMicros: 5_000_000_000,
  avgProbability: 40,
  territories: [DEMO_TERRITORY],
  ownerNames: ['Pat Demo'],
};

type ReadStatus = {
  data: unknown;
  isPending: boolean;
  isLoading: boolean;
  isFetching: boolean;
  isPaused: boolean;
  isError: boolean;
  fetchStatus: 'idle' | 'paused' | 'fetching';
  error: Error | null;
  refetch: () => void;
};

function readStatus(next: Partial<ReadStatus> = {}): ReadStatus {
  return {
    data: undefined,
    isPending: false,
    isLoading: false,
    isFetching: false,
    isPaused: false,
    isError: false,
    fetchStatus: 'idle',
    error: null,
    refetch: vi.fn(),
    ...next,
  };
}

function mockReads(analytics: Partial<ReadStatus>) {
  vi.mocked(useTerritories).mockReturnValue(
    readStatus({
      data: {
        items: [
          {
            id: 'territory-demo-1',
            orgId: 'org-demo',
            name: DEMO_TERRITORY,
            region: 'DEMO',
            countryCodes: ['FR'],
            postalCodes: [] as string[],
            active: true,
            ownerId: 'user-demo',
            ownerName: 'Pat Demo',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
        pageContinues: false,
      },
    }) as ReturnType<typeof useTerritories>,
  );
  vi.mocked(useLeadRoutingRules).mockReturnValue(
    readStatus({
      data: { items: [], pageContinues: false },
    }) as ReturnType<typeof useLeadRoutingRules>,
  );
  vi.mocked(useTerritoryAnalytics).mockReturnValue(
    readStatus(analytics) as ReturnType<typeof useTerritoryAnalytics>,
  );
  vi.mocked(useTerritorySegments).mockReturnValue(
    readStatus() as ReturnType<typeof useTerritorySegments>,
  );
}

function renderPage(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

function expectMapHeading() {
  expect(screen.getByRole('heading', { level: 2, name: 'Global Opportunity Map' })).toBeTruthy();
}

describe('TerritoriesPage territory map read', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    useCurrencyStore.setState({ currency: 'USD' });
    await i18n.changeLanguage('en');
    i18n.addResourceBundle(
      'en',
      'crm',
      {
        territories: {
          pageTitle: 'Territories',
          sectionTitleRegion: 'Global Opportunity Map',
          mapChecking: CHECKING,
          mapErrorTitle: FAILED,
          mapEmptyTitle: EMPTY,
          retryButton: 'Retry',
        },
      },
      true,
      true,
    );
  });

  afterEach(() => {
    cleanup();
  });

  it('does not call an unread territory map empty', () => {
    // WHY: the demo page paints before the analytics request starts.
    // fetchStatus is idle and isLoading is false, so an absent payload
    // becomes "No geographic data". The demo book has not been read.
    mockReads({ isPending: true, isLoading: false, isPaused: false, fetchStatus: 'idle' });
    renderPage(<TerritoriesPage />);

    expectMapHeading();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.getByText(CHECKING)).toBeTruthy();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByTestId('composable-map')).toBeNull();
    expect(screen.getByText(DEMO_TERRITORY)).toBeTruthy();
  });

  it('does not call a paused territory map empty', () => {
    // WHY: a paused read (offline demo tab) has no countries. isLoading is
    // false because the fetch is not running. "No geographic data" would say
    // the map already came back empty.
    mockReads({
      isPending: true,
      isLoading: false,
      isFetching: false,
      isPaused: true,
      fetchStatus: 'paused',
    });
    renderPage(<TerritoriesPage />);

    expectMapHeading();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.getByText(CHECKING)).toBeTruthy();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByTestId('composable-map')).toBeNull();
  });

  it('does not call an in-flight territory map empty', () => {
    // WHY: the first fetch still has no countries. The skeleton is a wait,
    // not a census. "No geographic data" must not sit on that wait.
    mockReads({
      isPending: true,
      isLoading: true,
      isFetching: true,
      isPaused: false,
      fetchStatus: 'fetching',
    });
    renderPage(<TerritoriesPage />);

    expectMapHeading();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByTestId('composable-map')).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
  });

  it('does not call a failed territory map an empty book', () => {
    // WHY: a failed map read is not zero countries. The error stays, and
    // "No geographic data" does not stand in for a payload that never arrived.
    mockReads({ isError: true, error: new Error('Territory map unavailable') });
    renderPage(<TerritoriesPage />);

    expectMapHeading();
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.getByText('Territory map unavailable')).toBeTruthy();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByTestId('composable-map')).toBeNull();
  });

  it('keeps a settled empty territory map empty', () => {
    // WHY: a map that arrived with no countries really is empty. "No
    // geographic data" is that census, not a missing payload.
    mockReads({
      data: {
        totals: {
          totalOpportunities: 0,
          totalCountries: 0,
          totalValueMicros: 0,
          avgProbability: 0,
        },
        items: [],
      },
    });
    renderPage(<TerritoriesPage />);

    expect(screen.getByText(EMPTY)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByTestId('composable-map')).toBeNull();
  });

  it('keeps a loaded country on the map', () => {
    // WHY: a payload that arrived, including the synthetic demo country,
    // still draws the map. The hold is only for a read that has not arrived.
    mockReads({
      data: {
        totals: {
          totalOpportunities: 2,
          totalCountries: 1,
          totalValueMicros: 5_000_000_000,
          avgProbability: 40,
        },
        items: [DEMO_COUNTRY],
      },
    });
    renderPage(<TerritoriesPage />);

    expect(screen.getByTestId('composable-map')).toBeTruthy();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.getByText(DEMO_TERRITORY)).toBeTruthy();
  });
});
