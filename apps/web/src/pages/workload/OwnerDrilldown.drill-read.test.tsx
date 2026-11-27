// A paused, idle, or in-flight desk read has no rows yet. The drilldown used
// the same "No live bids on this desk right now." line as a desk that arrived
// empty. The bids have not arrived, so that sentence is not a finding.
import type { ReactNode } from 'react';

import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Opportunity } from '@bidstack/shared';

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

import { OwnerDrilldown } from './OwnerDrilldown';

const OWNER = 'Ada North';
const EMAIL = 'ada.north@example.com';
const EMPTY = 'No live bids on this desk right now.';
const WAITING = 'Checking this desk. The live bids have not arrived.';
const BID = 'Example Transit';
const BID_ID = '44444444-4444-4444-8444-444444444444';

function liveBid(): Opportunity {
  return {
    id: BID_ID,
    code: 'OP-2401',
    customer: BID,
    name: 'Depot resignalling',
    stage: 's2_sent',
    pipelineStageId: null,
    pipelineStage: null,
    value: 5,
    probability: 50,
    dueDate: null,
    owner: EMAIL,
    industry: null,
    logo: null,
    country: null,
    territoryId: null,
    territoryName: null,
    updatedAt: '2026-07-01T00:00:00.000Z',
    taskCount: 0,
    commentCount: 0,
    viewCount: 0,
    bidClass: null,
    fteEstimate: null,
    commitmentLevel: null,
  };
}

function renderDrill(options?: { enabled?: boolean }) {
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
  return render(<OwnerDrilldown email={EMAIL} ownerLabel={OWNER} />, { wrapper: Wrapper });
}

function hang(): Promise<never> {
  return new Promise(() => undefined);
}

function expectNoSettledMiss() {
  expect(screen.queryByText(EMPTY)).toBeNull();
  expect(screen.queryByText(BID)).toBeNull();
  expect(screen.queryByRole('link', { name: /Example Transit/ })).toBeNull();
}

describe('OwnerDrilldown unread desk', () => {
  afterEach(() => {
    cleanup();
    apiMock.mockReset();
    onlineManager.setOnline(true);
  });

  it('does not call a paused desk read an empty desk', async () => {
    // WHY: a paused first read has isLoading false and no rows. Demo workload
    // then said this desk has no live bids, while the owner's bids have not arrived.
    onlineManager.setOnline(false);
    apiMock.mockImplementation(hang);

    renderDrill();

    await waitFor(() => {
      expect(screen.queryByText(EMPTY)).toBeNull();
    });
    expect(await screen.findByText(WAITING)).toBeTruthy();
    expectNoSettledMiss();
  });

  it('does not call an in-flight desk read an empty desk', async () => {
    // WHY: the shimmer alone still sat where a settled empty desk sits.
    // A slow read is not an empty desk.
    onlineManager.setOnline(true);
    apiMock.mockImplementation(hang);

    renderDrill();

    expect(await screen.findByText(WAITING)).toBeTruthy();
    expectNoSettledMiss();
  });

  it('does not call a read that has not started an empty desk', async () => {
    // WHY: an idle read has isLoading false and no payload, so the desk said
    // it had no live bids before it asked.
    onlineManager.setOnline(true);
    apiMock.mockImplementation(hang);

    renderDrill({ enabled: false });

    await waitFor(() => {
      expect(screen.queryByText(EMPTY)).toBeNull();
    });
    expect(await screen.findByText(WAITING)).toBeTruthy();
    expectNoSettledMiss();
    expect(apiMock).not.toHaveBeenCalled();
  });

  it('does not call a failed desk read an empty desk', async () => {
    // WHY: a failed read is not evidence that the desk is clear. The error
    // stays, and the drilldown does not say there are no live bids.
    apiMock.mockImplementation((path: string) => {
      if (path.startsWith('/api/opportunities?')) return Promise.reject(new Error('network down'));
      return Promise.reject(new Error(`unhandled: ${path}`));
    });

    renderDrill();

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain("Couldn't load");
    expect(screen.getByRole('alert').textContent).toContain(OWNER);
    expect(screen.queryByText(WAITING)).toBeNull();
    expectNoSettledMiss();
  });

  it('still says a settled desk has no live bids', async () => {
    // WHY: a payload that arrived with no open rows is a clear desk. That line
    // stays, so a real empty desk is not dressed up as a slow network.
    apiMock.mockImplementation((path: string) => {
      if (path.startsWith('/api/opportunities?')) return Promise.resolve({ items: [], nextCursor: null });
      return Promise.reject(new Error(`unhandled: ${path}`));
    });

    renderDrill();

    expect(await screen.findByText(EMPTY)).toBeTruthy();
    expect(screen.queryByText(WAITING)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(BID)).toBeNull();
  });

  it('still shows a live bid that has arrived', async () => {
    // WHY: a loaded bid stays on the desk. The unread line must not replace a
    // row the read already returned.
    apiMock.mockImplementation((path: string) => {
      if (path.startsWith('/api/opportunities?')) {
        return Promise.resolve({ items: [liveBid()], nextCursor: null });
      }
      return Promise.reject(new Error(`unhandled: ${path}`));
    });

    renderDrill();

    const link = await screen.findByRole('link', { name: /Example Transit/ });
    expect(link.getAttribute('href')).toBe(`/opportunities/${BID_ID}`);
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByText(WAITING)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
