// The forecast headline is the number the bid team is held to. Until the
// manual forecast payload arrives, those four amounts are not zero. A paused
// read, an in-flight read, a failed read, and a payload with no items list
// must not print EUR 0. An empty list that arrived, and a commit that
// arrived, still show their amounts.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}));

vi.mock('@/hooks/useFormatMoney', () => ({
  useFormatMoney: () => ({
    formatMoneyMicros: (micros: number) => `EUR ${Number(micros)}`,
  }),
}));

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ api: apiMock }));

import { ForecastsPage } from './ForecastsPage';

const CHECKING = 'Checking the forecast totals. They have not arrived.';
const FAILED = 'Could not load the forecast totals. They have not arrived.';
const EMPTY_TITLE = 'No forecasts found';
const TOTALS_LABEL = 'Forecast totals for the selected period';

const COMMIT = {
  id: '11111111-1111-4111-8111-111111111111',
  orgId: '22222222-2222-4222-8222-222222222222',
  ownerId: '33333333-3333-4333-8333-333333333333',
  ownerName: 'Ada North',
  period: '2026-11',
  category: 'commit' as const,
  amountMicros: 4_200_000,
  currency: 'EUR',
  note: null,
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
};

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, networkMode: 'online', refetchOnWindowFocus: false },
    },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <ForecastsPage />
    </QueryClientProvider>,
  );
}

function settleNeighbors() {
  return (path: string) => {
    if (path.startsWith('/api/forecasts/projection')) {
      return Promise.resolve({
        currency: 'EUR',
        generatedAt: '2026-11-01T00:00:00.000Z',
        periods: [],
      });
    }
    if (path.startsWith('/api/users')) return Promise.resolve({ items: [], nextCursor: null });
    if (path.startsWith('/api/me/capabilities')) {
      return Promise.resolve({
        userId: '33333333-3333-4333-8333-333333333333',
        orgId: '22222222-2222-4222-8222-222222222222',
        legacyRole: 'admin',
        roles: ['Admin'],
        permissions: ['territories:write'],
        isAdmin: true,
      });
    }
    return undefined;
  };
}

describe('ForecastsPage forecast totals read', () => {
  afterEach(() => {
    cleanup();
    apiMock.mockReset();
    onlineManager.setOnline(true);
  });

  it('does not call a paused forecast read a zero commit', () => {
    // WHY: a paused first read has isLoading false and no items. The headline
    // still summed an empty list, so Commit, Pipeline, Best case, and Closed
    // read as EUR 0 while the payload has not arrived.
    onlineManager.setOnline(false);
    apiMock.mockImplementation((path: string) => {
      const neighbor = settleNeighbors()(path);
      if (neighbor !== undefined) return neighbor;
      if (path.startsWith('/api/forecasts')) return new Promise(() => {});
      return Promise.resolve({ items: [] });
    });

    renderPage();

    expect(screen.queryAllByText('EUR 0')).toEqual([]);
    expect(screen.queryByLabelText(TOTALS_LABEL)).toBeNull();
    expect(screen.getByRole('status').textContent).toContain(CHECKING);
    expect(screen.queryByText(FAILED)).toBeNull();
  });

  it('does not call an in-flight forecast read a zero commit', () => {
    // WHY: the list skeleton does not cover the headline. A slow read still
    // printed four zeros, which is the number the bid team is held to.
    onlineManager.setOnline(true);
    apiMock.mockImplementation((path: string) => {
      const neighbor = settleNeighbors()(path);
      if (neighbor !== undefined) return neighbor;
      if (path.startsWith('/api/forecasts')) return new Promise(() => {});
      return Promise.resolve({ items: [] });
    });

    renderPage();

    expect(screen.queryAllByText('EUR 0')).toEqual([]);
    expect(screen.queryByLabelText(TOTALS_LABEL)).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('They have not arrived.');
    expect(screen.getByRole('status').textContent).toContain('Checking the forecast totals');
  });

  it('does not call a failed forecast read a zero commit', async () => {
    // WHY: a failed read is not an empty book. Zero commit would say the bid
    // team is held to nothing. Retry asks for the same forecast list again.
    apiMock.mockImplementation((path: string) => {
      const neighbor = settleNeighbors()(path);
      if (neighbor !== undefined) return neighbor;
      if (path.startsWith('/api/forecasts')) return Promise.reject(new Error('forecast down'));
      return Promise.resolve({ items: [] });
    });

    renderPage();

    const totalsAlert = (await screen.findByText(FAILED)).closest('[role="alert"]');
    expect(totalsAlert).toBeTruthy();
    expect(screen.queryAllByText('EUR 0')).toEqual([]);
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByLabelText(TOTALS_LABEL)).toBeNull();

    const before = apiMock.mock.calls.filter(([path]) =>
      String(path).startsWith('/api/forecasts?'),
    ).length;
    fireEvent.click(within(totalsAlert as HTMLElement).getByRole('button', { name: 'Retry' }));
    expect(
      apiMock.mock.calls.filter(([path]) => String(path).startsWith('/api/forecasts?')).length,
    ).toBe(before + 1);
  });

  it('does not call a forecast payload with no items list a zero commit', async () => {
    // WHY: a settled response that never included the list is not an empty
    // forecast. Treating the missing list as [] printed EUR 0.
    apiMock.mockImplementation((path: string) => {
      const neighbor = settleNeighbors()(path);
      if (neighbor !== undefined) return neighbor;
      if (path.startsWith('/api/forecasts')) return Promise.resolve({ pageContinues: false });
      return Promise.resolve({ items: [] });
    });

    renderPage();

    expect(await screen.findByText(FAILED)).toBeTruthy();
    expect(screen.queryAllByText('EUR 0')).toEqual([]);
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByLabelText(TOTALS_LABEL)).toBeNull();
  });

  it('still shows zero once an empty forecast list has arrived', async () => {
    // WHY: an empty list that arrived is a real zero. The unread line must
    // not replace a settled empty book.
    apiMock.mockImplementation((path: string) => {
      const neighbor = settleNeighbors()(path);
      if (neighbor !== undefined) return neighbor;
      if (path.startsWith('/api/forecasts')) return Promise.resolve({ items: [], pageContinues: false });
      return Promise.resolve({ items: [] });
    });

    renderPage();

    expect(await screen.findByText(EMPTY_TITLE)).toBeTruthy();
    expect(screen.getAllByText('EUR 0')).toHaveLength(4);
    expect(screen.getByLabelText(TOTALS_LABEL)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
  });

  it('still shows a commit once that forecast has arrived', async () => {
    // WHY: a loaded commit stays on the headline. The unread line must not
    // replace an amount the read already returned.
    apiMock.mockImplementation((path: string) => {
      const neighbor = settleNeighbors()(path);
      if (neighbor !== undefined) return neighbor;
      if (path.startsWith('/api/forecasts')) {
        return Promise.resolve({ items: [COMMIT], pageContinues: false });
      }
      return Promise.resolve({ items: [] });
    });

    renderPage();

    expect((await screen.findAllByText('EUR 4200000')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Ada North').length).toBeGreaterThan(0);
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
  });
});
