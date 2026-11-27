// The team workload screen may say "No live bids on any desk" only after the
// payload arrives. A paused read has isLoading false and no owners, so the
// KPI tiles said 0 and the page said the desks were empty. A read that has
// not started did the same. An in-flight read showed 0 above a shimmer. A
// failed read kept those zeros next to the error. None of those reads have
// a desk count yet.
import type { ReactNode } from 'react';

import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { WorkloadResponse } from '@/hooks/useWorkload';

const apiMock = vi.hoisted(() => vi.fn());

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, unknown>) => {
      if (!values) return fallback;
      return fallback.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(values[name] ?? ''));
    },
  }),
}));

vi.mock('@/lib/api', () => ({
  api: apiMock,
}));

vi.mock('@/hooks/useFormatMoney', () => ({
  useFormatMoney: () => ({
    formatMoneyMicros: (micros: string | number | bigint) => String(micros),
  }),
}));

import WorkloadPage from '../WorkloadPage';

const EMPTY = 'No live bids on any desk';
const WAITING = 'Checking team workload. The desks have not arrived.';
const FAILED = "Couldn't load the team's workload";
const OWNER = 'Ada North';

function emptyPayload(): WorkloadResponse {
  return { generatedAt: '2026-07-05T08:00:00.000Z', owners: [] };
}

function loadedPayload(): WorkloadResponse {
  return {
    generatedAt: '2026-07-05T08:00:00.000Z',
    owners: [
      {
        ownerId: '11111111-1111-4111-8111-111111111111',
        name: OWNER,
        email: 'ada.north@example.com',
        openBids: 2,
        openValueMicros: '5000000',
        weightedValueMicros: '2500000',
        openTasks: 1,
        overdueTasks: 0,
        closingWithin7Days: 0,
      },
    ],
  };
}

function renderPage(options?: { enabled?: boolean }) {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        networkMode: 'online',
        ...(options?.enabled === false ? { enabled: false } : {}),
      },
    },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <MemoryRouter>{children}</MemoryRouter>
      </QueryClientProvider>
    );
  }
  const view = render(<WorkloadPage />, { wrapper: Wrapper });
  return { ...view, client };
}

function hang(): Promise<never> {
  return new Promise(() => undefined);
}

function expectNoSettledMiss() {
  expect(screen.queryByText(EMPTY)).toBeNull();
  expect(screen.queryByText(OWNER)).toBeNull();
  expect(screen.queryByTestId('workload-kpi-bids')).toBeNull();
  expect(screen.queryByTestId('workload-kpi-weighted')).toBeNull();
  expect(screen.queryByTestId('workload-kpi-over')).toBeNull();
  expect(screen.queryByTestId('workload-kpi-unassigned')).toBeNull();
}

describe('WorkloadPage unread desks', () => {
  afterEach(() => {
    cleanup();
    apiMock.mockReset();
    onlineManager.setOnline(true);
  });

  it('does not call a paused workload read an empty team', async () => {
    // WHY: a paused first read has isLoading false and no owners. The page
    // then said there were no live bids and showed 0 on every tile, while
    // the desks have not arrived.
    onlineManager.setOnline(false);
    apiMock.mockImplementation(hang);

    renderPage();

    await waitFor(() => {
      expect(screen.queryByText(EMPTY)).toBeNull();
    });
    expect(await screen.findByText(WAITING)).toBeTruthy();
    expectNoSettledMiss();
  });

  it('does not call a workload read that has not started an empty team', async () => {
    // WHY: a query that never leaves idle has isLoading false. That is not
    // a team with zero live bids.
    apiMock.mockImplementation(hang);

    renderPage({ enabled: false });

    expect(await screen.findByText(WAITING)).toBeTruthy();
    expect(apiMock).not.toHaveBeenCalled();
    expectNoSettledMiss();
  });

  it('does not show zero tiles while the workload read is in flight', async () => {
    // WHY: an in-flight read has no owners yet. Zero tiles above a shimmer
    // read as a team with no live bids.
    apiMock.mockImplementation(hang);

    renderPage();

    expect(await screen.findByText(WAITING)).toBeTruthy();
    expectNoSettledMiss();
  });

  it('does not show zero tiles when the workload read fails', async () => {
    // WHY: a failed read has no desk count. Zeros next to the error read as
    // a team that arrived empty.
    apiMock.mockRejectedValue(new Error('boom'));

    renderPage();

    expect(await screen.findByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(WAITING)).toBeNull();
    expectNoSettledMiss();
  });

  it('still says the team is empty after a settled empty payload', async () => {
    // WHY: an arrived payload with no live bids is a real empty team. The
    // waiting sentence must not replace that finding.
    apiMock.mockResolvedValue(emptyPayload());

    renderPage();

    expect(await screen.findByText(EMPTY)).toBeTruthy();
    expect(screen.getByText('Open the pipeline and assign owners')).toBeTruthy();
    expect(screen.queryByText(WAITING)).toBeNull();
    expect(screen.getByTestId('workload-kpi-bids').textContent).toBe('0');
    expect(screen.getByTestId('workload-kpi-unassigned').textContent).toBe('0');
  });

  it('still shows a desk after the payload arrives', async () => {
    // WHY: a loaded desk is the triage the page exists for. Waiting and
    // failure copy must not replace it.
    apiMock.mockResolvedValue(loadedPayload());

    renderPage();

    expect(await screen.findByText(OWNER)).toBeTruthy();
    expect(screen.getByTestId('workload-kpi-bids').textContent).toBe('2');
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByText(WAITING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
  });

  it('keeps a loaded desk when a later refresh fails', async () => {
    // WHY: a refresh that fails after a desk arrived must not wipe that desk
    // into the empty sentence or the load-failed sentence.
    apiMock.mockResolvedValueOnce(loadedPayload());
    apiMock.mockRejectedValueOnce(new Error('refresh failed'));

    const { client } = renderPage();

    expect(await screen.findByText(OWNER)).toBeTruthy();
    await client.invalidateQueries({ queryKey: ['analytics', 'workload'] });
    expect(await screen.findByText(OWNER)).toBeTruthy();
    expect(screen.getByTestId('workload-kpi-bids').textContent).toBe('2');
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText(WAITING)).toBeNull();
  });
});
