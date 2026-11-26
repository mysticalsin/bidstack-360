// A paused or in-flight deadlines read has no rows yet. The lane used the
// same "No deadlines" line as a settled empty week. The payload has not
// arrived, so it is not an empty week. A failed read is not an empty week
// either.
import type { ReactNode } from 'react';

import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}));

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ api: apiMock }));

import { DeadlinesRow } from './DeadlinesRow';

const WAITING = 'Checking deadlines. They have not arrived.';
const EMPTY = 'No deadlines';
const FAILED = 'Could not load deadlines.';

const WEEK = Array.from({ length: 7 }, (_, i) => new Date(2026, 2, 9 + i));

const DEADLINE = {
  kind: 'opportunity' as const,
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Bridge RFP',
  customer: 'Acme',
  code: 'OP-0001',
  dueDate: '2026-03-09',
};

function renderRow() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, networkMode: 'online' } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <MemoryRouter>{children}</MemoryRouter>
      </QueryClientProvider>
    );
  }
  return render(<DeadlinesRow days={WEEK} />, { wrapper: Wrapper });
}

function hang(): Promise<never> {
  return new Promise(() => {});
}

describe('DeadlinesRow unread deadlines', () => {
  afterEach(() => {
    cleanup();
    apiMock.mockReset();
    onlineManager.setOnline(true);
  });

  it('does not call a paused deadlines read an empty week', async () => {
    // WHY: a paused first read has isLoading false and no rows. The lane
    // said No deadlines while the due dates have not arrived. A bid team
    // would plan the week as if nothing is due.
    onlineManager.setOnline(false);
    apiMock.mockImplementation(hang);

    renderRow();

    expect(await screen.findByText(WAITING)).toBeTruthy();
    expect(screen.queryByText(EMPTY)).toBeNull();
  });

  it('does not call an in-flight deadlines read an empty week', async () => {
    // WHY: the skeleton alone still sat where a settled empty week would.
    // A slow read is not an empty list of deadlines.
    onlineManager.setOnline(true);
    apiMock.mockImplementation(hang);

    renderRow();

    expect(await screen.findByText(WAITING)).toBeTruthy();
    expect(screen.queryByText(EMPTY)).toBeNull();
  });

  it('does not call a failed deadlines read an empty week', async () => {
    // WHY: a failed read is not evidence that nothing is due. The error
    // stays in the lane. It does not say the week has no deadlines.
    apiMock.mockRejectedValue(new Error('network down'));

    renderRow();

    expect(await screen.findByText(FAILED)).toBeTruthy();
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByText(WAITING)).toBeNull();
  });

  it('still says a settled week found none', async () => {
    // WHY: a payload that arrived empty is a miss. The lane stays
    // No deadlines. That line is not a slow network.
    apiMock.mockResolvedValue({ items: [] });

    renderRow();

    expect(await screen.findByText(EMPTY)).toBeTruthy();
    expect(screen.queryByText(WAITING)).toBeNull();
  });

  it('still shows a deadline that has arrived', async () => {
    // WHY: a loaded deadline stays in the lane. The unread line must not
    // replace a bid the read already returned.
    apiMock.mockResolvedValue({ items: [DEADLINE] });

    renderRow();

    expect(await screen.findByRole('link', { name: /Bridge RFP/ })).toBeTruthy();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByText(WAITING)).toBeNull();
  });
});
