import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import SectorViewPage, { labeledCount, sectorDetailMeta, sectorRadarMeta } from './SectorViewPage';
import { useSectorView, type SectorViewResponse } from '@/hooks/useSectorView';
import { useTerritoryAnalytics, useTerritorySegments } from '@/hooks/useTerritories';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

vi.mock('@/hooks/useSectorView', () => ({ useSectorView: vi.fn() }));

vi.mock('@/hooks/useTerritories', () => ({
  useTerritoryAnalytics: vi.fn(),
  useTerritorySegments: vi.fn(),
}));

vi.mock('@/components/territories/WorldMap', () => ({
  WorldMap: () => <div data-testid="world-map" />,
}));

const RESPONSE: SectorViewResponse = {
  generatedAt: '2026-06-26T00:00:00Z',
  totalAccounts: 100,
  classifiedAccounts: 60,
  dataQualityWarning: false,
  sectors: [
    {
      sector: 'technology',
      accountCount: 40,
      fteVolume: 5000,
      coverage: { knownFteAccounts: 20, verifiedAccounts: 15, logoAccounts: 30 },
      countries: [{ countryCode: 'FR', accountCount: 25, fteVolume: 3000 }],
      accounts: [
        {
          id: 'a1',
          name: 'Acme',
          domain: 'acme.com',
          countryCode: 'FR',
          employeeCount: 500,
          source: 'verified_data',
          confidence: 0.9,
          updatedAt: '2026-06-20T00:00:00Z',
        },
      ],
    },
  ],
};

function mockView(value: Partial<ReturnType<typeof useSectorView>>) {
  vi.mocked(useSectorView).mockReturnValue(value as ReturnType<typeof useSectorView>);
}

function renderPage() {
  return render(
    <MemoryRouter>
      <SectorViewPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  const idle = { data: { items: [] }, isLoading: false, isError: false } as never;
  vi.mocked(useTerritoryAnalytics).mockReturnValue(idle);
  vi.mocked(useTerritorySegments).mockReturnValue(idle);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('SectorViewPage load resilience', () => {
  it('renders the loaded sector view', () => {
    mockView({ data: RESPONSE, isLoading: false, isError: false, error: null, refetch: vi.fn() });
    renderPage();

    expect(screen.getByText('Sector momentum')).toBeTruthy();
    expect(screen.getAllByText('Technology').length).toBeGreaterThan(0);
    expect(screen.queryByText('technology')).toBeNull();
    expect(screen.queryByText('Could not load the sector view')).toBeNull();
  });

  it('keeps the loaded view (no error wall) when a background refetch fails', () => {
    // WHY: refetchOnWindowFocus after idle can transiently fail (network blip /
    // token rotation); React Query keeps the last data. The page must NOT discard
    // a working view for a hard "Could not load" wall — it must heal on next focus.
    const refetch = vi.fn();
    mockView({
      data: RESPONSE,
      isLoading: false,
      isError: true,
      error: new Error('focus refetch failed'),
      refetch,
    });
    renderPage();

    expect(screen.queryByText('Could not load the sector view')).toBeNull();
    expect(screen.getByText('Sector momentum')).toBeTruthy();
    // A non-blocking retry is offered instead of nuking the page.
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('keeps the stale banner + Retry (not a confirmed-empty state) when a refetch fails over an empty result', () => {
    // WHY: a successful empty load followed by a failed background refetch must
    // not read as a confirmed-empty portfolio — that hides the transient failure
    // and strips the Retry. isError-with-empty-data falls through to the banner.
    const refetch = vi.fn();
    mockView({
      data: { ...RESPONSE, sectors: [] },
      isLoading: false,
      isError: true,
      error: new Error('refetch failed over empty'),
      refetch,
    });
    renderPage();

    expect(screen.queryByText('No sector data yet')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('shows the error wall with a retry only when there is no data at all', () => {
    const refetch = vi.fn();
    mockView({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error('cold load failed'),
      refetch,
    });
    renderPage();

    expect(screen.getByText('Could not load the sector view')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('keeps the world map and labels industry pipeline as unspecified', () => {
    // WHY: opportunity totals have no stored currency. An industry chart that
    // prints euros would invent a forecast the sector rollup does not have.
    mockView({ data: RESPONSE, isLoading: false, isError: false, error: null, refetch: vi.fn() });
    vi.mocked(useTerritoryAnalytics).mockReturnValue({
      data: {
        items: [
          {
            countryCode: 'FR',
            countryCodeA3: 'FRA',
            opportunityCount: 2,
            totalValueMicros: 1_500_000_000_000,
            avgProbability: 40,
            territories: [],
            ownerNames: [],
          },
        ],
      },
      isLoading: false,
      isError: false,
    } as never);
    vi.mocked(useTerritorySegments).mockReturnValue({
      data: {
        items: [
          {
            key: 'technology',
            label: 'technology',
            opportunityCount: 2,
            totalValueMicros: 1_500_000_000_000,
            avgProbability: 40,
            ownerNames: [],
          },
        ],
      },
      isLoading: false,
      isError: false,
    } as never);
    renderPage();

    expect(screen.getByTestId('world-map')).toBeTruthy();
    expect(screen.getByText('currency not recorded; not a euro forecast')).toBeTruthy();
    expect(screen.getByText(/As of/)).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: 'By industry' }));
    expect(screen.getAllByText('Technology').length).toBeGreaterThan(0);
    expect(screen.getByText(/unspecified/)).toBeTruthy();
    expect(document.body.textContent ?? '').not.toMatch(/€|\$|\bEUR\b/);

    fireEvent.click(screen.getByRole('tab', { name: 'By country' }));
    expect(screen.getByTestId('world-map')).toBeTruthy();
  });
});

describe('sector count wording', () => {
  it('uses the singular when a sector has one account or one country', () => {
    expect(sectorRadarMeta(1, 1)).toBe('1 account / 1 country');
    expect(sectorRadarMeta(2, 3)).toBe('2 accounts / 3 countries');
    expect(sectorDetailMeta(1, 2)).toBe('1 account across 2 countries');
    expect(labeledCount(1, 'account', 'accounts')).toBe('1 account');
    expect(labeledCount(9, 'account', 'accounts')).toBe('9 accounts');
  });
});
