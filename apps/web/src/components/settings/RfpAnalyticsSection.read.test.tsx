// The admin proposal rollup counts the book. Before the payload arrives the
// counts are zero, and a paused read has isLoading false, so the section said
// "No RFPs yet" and "0 won · 0 closed". An empty book and a failed read
// already have their own sentences and must keep them.
import type { ReactNode } from 'react';

import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, opts?: Record<string, unknown>) => {
      if (!opts || typeof fallback !== 'string') return fallback;
      return Object.entries(opts).reduce(
        (str, [k, v]) => str.replace(`{{${k}}}`, String(v)),
        fallback,
      );
    },
  }),
}));

const CHECKING = 'Checking proposals. The analytics have not arrived.';
const EMPTY = 'No RFPs yet';
const NO_OWNERS = 'No owners yet';
const ZERO_CLOSED = '0 won · 0 closed';
const LOAD_ERROR = 'Failed to load RFP analytics. Please retry.';

const BOOK = {
  totalCount: 2,
  wonCount: 1,
  lostCount: 0,
  totalValueMicros: '1000000',
  byStatus: [
    { status: 'draft', count: 1 },
    { status: 'won', count: 1 },
  ],
  byOwner: [
    {
      ownerId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      ownerName: 'Ada Example',
      count: 2,
      totalValueMicros: '1000000',
    },
  ],
};

const EMPTY_BOOK = {
  totalCount: 0,
  wonCount: 0,
  lostCount: 0,
  totalValueMicros: '0',
  byStatus: [],
  byOwner: [],
};

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ api: apiMock }));

import { RfpAnalyticsSection } from './RfpAnalyticsSection';

function renderSection() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, networkMode: 'online' } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return render(<RfpAnalyticsSection />, { wrapper: Wrapper });
}

describe('RfpAnalyticsSection proposal read', () => {
  afterEach(() => {
    cleanup();
    onlineManager.setOnline(true);
    apiMock.mockReset();
  });

  it('does not call a paused analytics read an empty book', () => {
    // WHY: a paused first read has isLoading false and no payload. The KPI
    // strip printed 0, and the status card said the org had no RFPs. The
    // book had not arrived.
    onlineManager.setOnline(false);
    apiMock.mockImplementation(() => new Promise(() => {}));

    renderSection();

    expect(screen.getByText(CHECKING)).toBeTruthy();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByText(NO_OWNERS)).toBeNull();
    expect(screen.queryByText(ZERO_CLOSED)).toBeNull();
    expect(screen.queryByText('Ada Example')).toBeNull();
  });

  it('does not call an in-flight analytics read an empty book', () => {
    // WHY: while the request is in flight the closed-count line is still
    // computed from missing numbers, so the section said 0 won. The shimmer
    // does not say the payload has not arrived.
    onlineManager.setOnline(true);
    apiMock.mockImplementation(() => new Promise(() => {}));

    renderSection();

    expect(screen.getByText(CHECKING)).toBeTruthy();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByText(NO_OWNERS)).toBeNull();
    expect(screen.queryByText(ZERO_CLOSED)).toBeNull();
  });

  it('keeps a failed read on the error, not on an empty book', async () => {
    // WHY: a failed read is not evidence the org has no proposals. The
    // error line stays, and the empty titles do not replace it.
    apiMock.mockImplementation(() => Promise.reject(new Error('network down')));

    renderSection();

    expect(await screen.findByText(LOAD_ERROR)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByText(NO_OWNERS)).toBeNull();
    expect(screen.queryByText(ZERO_CLOSED)).toBeNull();
  });

  it('still says the book is empty after a settled read with no proposals', async () => {
    // WHY: a payload that arrived empty is an empty book. The checking line
    // is only for a read that has not arrived.
    apiMock.mockImplementation(() => Promise.resolve(EMPTY_BOOK));

    renderSection();

    expect(await screen.findByText(EMPTY)).toBeTruthy();
    expect(screen.getByText(NO_OWNERS)).toBeTruthy();
    expect(screen.getByText(ZERO_CLOSED)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
  });

  it('shows the book once the analytics arrive', async () => {
    // WHY: the checking line is not a permanent caption. A payload that
    // arrived is the rollup, including the owner the directory named.
    apiMock.mockImplementation(() => Promise.resolve(BOOK));

    renderSection();

    expect(await screen.findByText('Ada Example')).toBeTruthy();
    expect(screen.getByText('Draft')).toBeTruthy();
    expect(screen.getByText('Won')).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByText(NO_OWNERS)).toBeNull();
  });
});
