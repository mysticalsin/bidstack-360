// The demo seed writes opportunities and no forecast rows. Revenue Forecasts
// still drew Commit, Best case, Pipeline, and Closed as zero. That zero is
// not a forecast the rep entered. The projection above is the number until
// someone saves a manual amount.
import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, opts?: Record<string, unknown>) => {
      if (!opts) return fallback;
      return Object.entries(opts).reduce(
        (str, [k, v]) => str.replace(`{{${k}}}`, String(v)),
        fallback,
      );
    },
    i18n: { language: 'en' },
  }),
}));

const capabilitiesMocks = vi.hoisted(() => ({ useHasPermission: vi.fn(() => true) }));
vi.mock('@/hooks/useCapabilities', () => capabilitiesMocks);

const forecastsMocks = vi.hoisted(() => ({
  useForecastProjection: vi.fn(() => ({ data: undefined, isLoading: false, isError: false })),
  useForecasts: vi.fn(),
  useCreateForecast: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })),
  useDeleteForecast: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })),
}));
vi.mock('@/hooks/useForecasts', () => forecastsMocks);

const usersMocks = vi.hoisted(() => ({ useUsers: vi.fn(() => ({ data: [] })) }));
vi.mock('@/hooks/useUsers', () => usersMocks);

import { ForecastsPage } from './ForecastsPage';

const savedForecast = {
  id: 'f-1',
  orgId: 'org-1',
  ownerId: 'owner-1',
  ownerName: 'Alice Dev',
  period: '2026-08',
  category: 'commit' as const,
  amountMicros: 5_000_000,
  currency: 'EUR',
  note: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return render(<ForecastsPage />, { wrapper: Wrapper });
}

describe('ForecastsPage manual totals on an empty book', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('does not print a zero commit when no manual forecast has been entered', () => {
    // WHY: demo data has pipeline and no forecast rows. Four zero tiles
    // labeled Commit answer the page with a figure nobody entered, under a
    // projection that already holds the book.
    forecastsMocks.useForecasts.mockReturnValue({
      data: { items: [] },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();

    expect(screen.queryByText('Commit')).toBeNull();
    expect(
      screen.getByRole('status', {
        name: 'No manual amounts yet. The projection above is the forecast.',
      }),
    ).toBeTruthy();
  });

  it('keeps the totals while the forecast list is still loading', () => {
    // WHY: a read in flight is not an empty book. The zero tiles during
    // loading are a separate hold. This empty-book line must wait until
    // the list has settled with no rows.
    forecastsMocks.useForecasts.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();

    expect(screen.getAllByText('Commit').length).toBeGreaterThan(0);
    expect(
      screen.queryByRole('status', {
        name: 'No manual amounts yet. The projection above is the forecast.',
      }),
    ).toBeNull();
  });

  it('still shows commit once a manual forecast is loaded', () => {
    // WHY: the tiles exist to sum amounts a rep saved. An empty book is the
    // case that must not invent a zero. A saved commit is a real total.
    forecastsMocks.useForecasts.mockReturnValue({
      data: { items: [savedForecast] },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();

    expect(screen.getAllByText('Commit').length).toBeGreaterThan(0);
    expect(
      screen.queryByRole('status', {
        name: 'No manual amounts yet. The projection above is the forecast.',
      }),
    ).toBeNull();
  });
});
