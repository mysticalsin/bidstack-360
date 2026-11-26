// WHY: Forecast Details treats a missing payload as an empty book. A paused
// read has isLoading false and no items, so the section says "0 forecast
// groups" and "No forecasts found". An in-flight read keeps that zero caption.
// A payload with no items list does the same. Those sentences are a claim
// that the manual book arrived and is empty. A list that has not arrived is
// not an empty book. A list that arrived empty still is.
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

vi.mock('@/hooks/useCapabilities', () => ({ useHasPermission: () => true }));

const forecastsMocks = vi.hoisted(() => ({
  useForecastProjection: vi.fn(() => ({ data: undefined, isLoading: false, isError: false })),
  useForecasts: vi.fn(),
  useCreateForecast: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })),
  useDeleteForecast: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })),
}));
vi.mock('@/hooks/useForecasts', () => forecastsMocks);

vi.mock('@/hooks/useUsers', () => ({ useUsers: () => ({ data: [] }) }));

import { ForecastsPage } from './ForecastsPage';

const CHECKING = 'Checking the forecast list. It has not arrived.';
const MISSING = 'Could not load the forecast list. It has not arrived.';
const EMPTY = 'No forecasts found';
const ZERO_GROUPS = '0 forecast groups';

const adaCommit = {
  id: 'f-ada',
  orgId: 'org-1',
  ownerId: 'owner-ada',
  ownerName: 'Ada North',
  period: '2026-08',
  category: 'commit' as const,
  amountMicros: 4_200_000,
  currency: 'EUR',
  note: null,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return render(<ForecastsPage />, { wrapper: Wrapper });
}

function forecastRead(overrides: Record<string, unknown>) {
  forecastsMocks.useForecasts.mockReturnValue({
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    ...overrides,
  });
}

describe('ForecastsPage forecast list has not arrived', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('does not call a paused read an empty forecast list', () => {
    forecastRead({ data: undefined, isLoading: false, isError: false });
    renderPage();
    expect(screen.getByText(CHECKING)).toBeTruthy();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByText(ZERO_GROUPS)).toBeNull();
  });

  it('does not caption an in-flight read as zero forecast groups', () => {
    forecastRead({ data: undefined, isLoading: true, isError: false });
    renderPage();
    expect(screen.getByText(CHECKING)).toBeTruthy();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByText(ZERO_GROUPS)).toBeNull();
  });

  it('does not caption a failed read as zero forecast groups', () => {
    forecastRead({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error('forecast down'),
    });
    renderPage();
    expect(screen.getByText('Failed to load forecasts')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByText(ZERO_GROUPS)).toBeNull();
  });

  it('does not call a payload with no items list an empty forecast list', () => {
    const refetch = vi.fn();
    forecastRead({ data: {}, isLoading: false, isError: false, refetch });
    renderPage();
    expect(screen.getByText(MISSING)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByText(ZERO_GROUPS)).toBeNull();
  });

  it('still says there are no forecasts when an empty list has arrived', () => {
    forecastRead({ data: { items: [] }, isLoading: false, isError: false });
    renderPage();
    expect(screen.getByText(EMPTY)).toBeTruthy();
    expect(screen.getByText(ZERO_GROUPS)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(MISSING)).toBeNull();
  });

  it('still shows a commit that has arrived', () => {
    forecastRead({ data: { items: [adaCommit] }, isLoading: false, isError: false });
    renderPage();
    expect(screen.getAllByText('Ada North').length).toBeGreaterThan(0);
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(ZERO_GROUPS)).toBeNull();
  });
});
