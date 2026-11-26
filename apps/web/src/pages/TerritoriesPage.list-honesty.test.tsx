// The territory list is a census of the demo book. Until that read arrives,
// "0 total" and "No territories" are a count the page invented. A paused
// read has no payload and isLoading is false, so the empty state fires.
// An in-flight read still prints "0 total" above the skeleton. A failed
// read with no payload is not an empty book. A later failure keeps the
// rows already on screen. A settled empty page still says "No territories".
import { cleanup, render, screen, within } from '@testing-library/react';
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

// The loaded map must not fetch world-atlas during the list assertions.
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

const CHECKING = 'Checking territories. They have not arrived.';
const FAILED = 'Could not read territories.';
const EMPTY = 'No territories';
const DEMO_TERRITORY = 'Demo North';
const DEMO_RULE = 'Demo Route';

const DEMO_TERRITORY_ROW = {
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

function mockReads(territories: Partial<ReadStatus>) {
  vi.mocked(useTerritories).mockReturnValue(
    readStatus(territories) as ReturnType<typeof useTerritories>,
  );
  vi.mocked(useLeadRoutingRules).mockReturnValue(
    readStatus({
      data: {
        items: [
          {
            id: 'rule-demo-1',
            orgId: 'org-demo',
            name: DEMO_RULE,
            priority: 1,
            criteria: { countryCode: 'FR' },
            active: true,
            assignToUserId: null,
            assignToTerritoryId: 'territory-demo-1',
            roundRobinTeam: [],
            roundRobinIndex: 0,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
        pageContinues: false,
      },
    }) as ReturnType<typeof useLeadRoutingRules>,
  );
  vi.mocked(useTerritoryAnalytics).mockReturnValue(
    readStatus({
      data: {
        totals: {
          totalOpportunities: 2,
          totalCountries: 1,
          totalValueMicros: 5_000_000_000,
          avgProbability: 40,
        },
        items: [
          {
            countryCode: 'FR',
            countryCodeA3: 'FRA',
            opportunityCount: 2,
            totalValueMicros: 5_000_000_000,
            avgProbability: 40,
            territories: [DEMO_TERRITORY],
            ownerNames: ['Pat Demo'],
          },
        ],
      },
    }) as ReturnType<typeof useTerritoryAnalytics>,
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

function expectListHeading() {
  expect(screen.getByRole('heading', { level: 2, name: 'Territories' })).toBeTruthy();
}

function expectNotInventedEmpty() {
  const panel = territoryPanel();
  expect(panel.queryByText(EMPTY)).toBeNull();
  expect(panel.queryByText('0 total')).toBeNull();
  expect(panel.queryByText(DEMO_TERRITORY)).toBeNull();
}

function territoryPanel() {
  const heading = screen.getByRole('heading', { level: 2, name: 'Territories' });
  const panel = heading.parentElement?.parentElement;
  if (!panel) throw new Error('territory list panel missing');
  return within(panel);
}

describe('TerritoriesPage territory list read', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    useCurrencyStore.setState({ currency: 'USD' });
    // The test runner boots i18n with empty bundles, so a default string is
    // not interpolated. Seed the census copy the English locale ships.
    await i18n.changeLanguage('en');
    i18n.addResourceBundle(
      'en',
      'crm',
      {
        territories: {
          pageTitle: 'Territories',
          totalsBadge: '{{opportunities}} opps across {{countries}} countries',
        },
        territoryPanels: {
          territories: 'Territories',
          countTotal: '{{count}} total',
          noTerritories: 'No territories',
          listChecking: 'Checking territories. They have not arrived.',
          listFailed: 'Could not read territories.',
          failedToLoad: 'Failed to load',
          retry: 'Retry',
        },
      },
      true,
      true,
    );
  });

  afterEach(() => {
    cleanup();
  });

  it('does not call an unread territory list empty', () => {
    // WHY: the demo page paints before the territory request starts.
    // fetchStatus is idle and isLoading is false, so [] becomes "0 total"
    // and "No territories". The demo book has not been read. That is not
    // an empty list and not a missing panel.
    mockReads({ isPending: true, isLoading: false, isPaused: false, fetchStatus: 'idle' });
    renderPage(<TerritoriesPage />);

    expectListHeading();
    expect(territoryPanel().getByText(CHECKING)).toBeTruthy();
    expectNotInventedEmpty();
    expect(territoryPanel().queryByText(FAILED)).toBeNull();
    expect(screen.getByText(DEMO_RULE)).toBeTruthy();
  });

  it('does not call a paused territory list empty', () => {
    // WHY: a paused read (offline demo tab) has no rows. isLoading is false
    // because the fetch is not running. "No territories" would say the
    // census already came back empty.
    mockReads({
      isPending: true,
      isLoading: false,
      isFetching: false,
      isPaused: true,
      fetchStatus: 'paused',
    });
    renderPage(<TerritoriesPage />);

    expectListHeading();
    expect(territoryPanel().getByText(CHECKING)).toBeTruthy();
    expectNotInventedEmpty();
    expect(territoryPanel().queryByText(FAILED)).toBeNull();
  });

  it('does not call an in-flight territory list empty', () => {
    // WHY: the first fetch still has no rows. The heading prints "0 total"
    // while the skeleton shows. A zero census is not a list that arrived,
    // and hiding the Territories heading would say the panel is missing.
    mockReads({
      isPending: true,
      isLoading: true,
      isFetching: true,
      isPaused: false,
      fetchStatus: 'fetching',
    });
    renderPage(<TerritoriesPage />);

    expectListHeading();
    expect(territoryPanel().getByText(CHECKING)).toBeTruthy();
    expectNotInventedEmpty();
    expect(territoryPanel().queryByText(FAILED)).toBeNull();
  });

  it('does not call a failed territory list an empty book', () => {
    // WHY: a failed list read is not zero territories. "0 total" above the
    // error still claims the demo book was counted and found empty.
    mockReads({ isError: true, error: new Error('Territory list unavailable') });
    renderPage(<TerritoriesPage />);

    expectListHeading();
    const panel = territoryPanel();
    expect(panel.getByRole('alert')).toBeTruthy();
    expect(panel.getByText(FAILED)).toBeTruthy();
    expect(panel.getByText('Territory list unavailable')).toBeTruthy();
    expectNotInventedEmpty();
    expect(panel.queryByText(CHECKING)).toBeNull();
  });

  it('keeps a settled empty territory list empty', () => {
    // WHY: a list that arrived with no rows really is empty. "No territories"
    // and "0 total" are the census, not a missing payload.
    mockReads({ data: { items: [], pageContinues: false } });
    renderPage(<TerritoriesPage />);

    const panel = territoryPanel();
    expect(panel.getByText(EMPTY)).toBeTruthy();
    expect(panel.getByText('0 total')).toBeTruthy();
    expect(panel.queryByText(CHECKING)).toBeNull();
    expect(panel.queryByText(FAILED)).toBeNull();
  });

  it('keeps a loaded territory on the list', () => {
    // WHY: a payload that arrived, including the synthetic demo row, still
    // shows that row. The hold is only for a list that has not arrived.
    mockReads({ data: { items: [DEMO_TERRITORY_ROW], pageContinues: false } });
    renderPage(<TerritoriesPage />);

    const panel = territoryPanel();
    expect(panel.getByText(DEMO_TERRITORY)).toBeTruthy();
    expect(panel.getByText('Pat Demo')).toBeTruthy();
    expect(panel.getByText('1 total')).toBeTruthy();
    expect(panel.queryByText(CHECKING)).toBeNull();
    expect(panel.queryByText(FAILED)).toBeNull();
    expect(panel.queryByText(EMPTY)).toBeNull();
  });

  it('keeps a loaded territory list when a later read fails', () => {
    // WHY: a refresh that fails does not erase rows already on screen and
    // does not replace them with an empty census. The failure sentence is
    // for a read that never arrived.
    mockReads({
      data: { items: [DEMO_TERRITORY_ROW], pageContinues: false },
      isError: true,
      isFetching: false,
      error: new Error('Territory list unavailable'),
    });
    renderPage(<TerritoriesPage />);

    const panel = territoryPanel();
    expect(panel.getByText(DEMO_TERRITORY)).toBeTruthy();
    expect(panel.queryByText(FAILED)).toBeNull();
    expect(panel.queryByText('Territory list unavailable')).toBeNull();
    expect(panel.queryByText(EMPTY)).toBeNull();
  });
});
