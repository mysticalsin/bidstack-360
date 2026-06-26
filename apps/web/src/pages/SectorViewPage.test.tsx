import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import SectorViewPage from './SectorViewPage';
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
});
