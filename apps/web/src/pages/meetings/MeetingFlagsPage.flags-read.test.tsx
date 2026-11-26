// A paused or in-flight flags read has no rows yet. The page used the same
// "No open flags" line as a settled empty book, and the tab used the same
// "Cross-region flags" label as zero flags. The payload has not arrived, so
// it is not an empty book. A failed read is not zero flags either.
import type { ReactNode } from 'react';

import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  api: apiMock,
}));

import { ApiError } from '@/lib/api';

import MeetingFlagsPage from './MeetingFlagsPage';

const OPEN_EMPTY = 'No open flags. When a colleague meets someone at a sister account, it shows up here.';
const DISMISSED_EMPTY = 'Nothing dismissed.';
const WAITING = 'Checking flags. They have not arrived.';
const TAB_WAITING = 'Checking flags';
const FAILED = "Couldn't load flags";
const ZERO_TAB = 'Cross-region flags';
const FLAG_REASON = 'Sister account met a buyer';

const FLAG = {
  id: 'f-sample',
  meetingId: '22222222-2222-4222-8222-222222222222',
  parentCompanyId: '11111111-1111-4111-8111-111111111111',
  parentCompanyName: 'Northwind group',
  companyName: 'Northwind Europe',
  companyRestricted: false,
  ownedCompanyId: '11111111-1111-4111-8111-111111111111',
  ownedCompanyName: 'Northwind Analytics',
  reason: FLAG_REASON,
  talkingPoints: ['Ask about the renewal'],
  status: 'open' as const,
  createdAt: '2026-10-31T10:00:00.000Z',
};

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, networkMode: 'online' } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/meetings/flags']}>{children}</MemoryRouter>
      </QueryClientProvider>
    );
  }
  return render(<MeetingFlagsPage />, { wrapper: Wrapper });
}

function hang(): Promise<never> {
  return new Promise(() => {});
}

function isFlags(path: string): boolean {
  return path.startsWith('/api/meeting-intel/flags');
}

function emptyFlags(): Promise<unknown> {
  return Promise.resolve({ items: [], flagsContinue: false });
}

describe('MeetingFlagsPage unread flags', () => {
  afterEach(() => {
    cleanup();
    apiMock.mockReset();
    onlineManager.setOnline(true);
  });

  it('does not call a paused flags read an empty book', async () => {
    // WHY: a paused first read has isLoading false and no rows. The page
    // said No open flags, and the tab used the zero-flag label, while the
    // flags have not arrived. Dismissed uses the same unread payload.
    onlineManager.setOnline(false);
    apiMock.mockImplementation(hang);

    renderPage();

    expect(await screen.findByText(WAITING)).toBeTruthy();
    expect(screen.getByRole('link', { name: TAB_WAITING })).toBeTruthy();
    expect(screen.queryByText(OPEN_EMPTY)).toBeNull();
    expect(screen.queryByRole('link', { name: ZERO_TAB })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Dismissed' }));

    expect(screen.getByText(WAITING)).toBeTruthy();
    expect(screen.queryByText(DISMISSED_EMPTY)).toBeNull();
    expect(screen.queryByText(OPEN_EMPTY)).toBeNull();
  });

  it('does not call an in-flight flags read an empty book', async () => {
    // WHY: the skeleton alone still sat where a settled empty book would,
    // and the tab already said Cross-region flags, the zero-flag label.
    // A slow read is not an empty list.
    onlineManager.setOnline(true);
    apiMock.mockImplementation(hang);

    renderPage();

    expect(await screen.findByText(WAITING)).toBeTruthy();
    expect(screen.getByRole('link', { name: TAB_WAITING })).toBeTruthy();
    expect(screen.queryByText(OPEN_EMPTY)).toBeNull();
    expect(screen.queryByRole('link', { name: ZERO_TAB })).toBeNull();
  });

  it('does not call a failed flags read an empty book', async () => {
    // WHY: a failed read is not evidence there are no flags. The error
    // stays on the page and on the tab. Neither one says the book is empty.
    apiMock.mockImplementation((path: string) => {
      if (isFlags(path)) return Promise.reject(new ApiError('network down', 403, {}));
      return Promise.reject(new Error(`unhandled: ${path}`));
    });

    renderPage();

    expect(await screen.findByRole('heading', { name: FAILED })).toBeTruthy();
    expect(screen.getByRole('link', { name: FAILED })).toBeTruthy();
    expect(screen.queryByText(OPEN_EMPTY)).toBeNull();
    expect(screen.queryByText(DISMISSED_EMPTY)).toBeNull();
    expect(screen.queryByText(WAITING)).toBeNull();
    expect(screen.queryByRole('link', { name: ZERO_TAB })).toBeNull();
  });

  it('still says a settled list found none', async () => {
    // WHY: a payload that arrived empty is a miss. Open stays No open flags.
    // Dismissed stays Nothing dismissed. Those lines are not a slow network.
    apiMock.mockImplementation((path: string) => {
      if (isFlags(path)) return emptyFlags();
      return Promise.reject(new Error(`unhandled: ${path}`));
    });

    renderPage();

    expect(await screen.findByText(OPEN_EMPTY)).toBeTruthy();
    expect(screen.getByRole('link', { name: ZERO_TAB })).toBeTruthy();
    expect(screen.queryByText(WAITING)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Dismissed' }));

    expect(await screen.findByText(DISMISSED_EMPTY)).toBeTruthy();
    expect(screen.queryByText(OPEN_EMPTY)).toBeNull();
    expect(screen.queryByText(WAITING)).toBeNull();
  });

  it('still shows a flag that has arrived', async () => {
    // WHY: a loaded flag stays on the list. The unread line must not
    // replace a reason the read already returned, and the tab keeps the count.
    apiMock.mockImplementation((path: string) => {
      if (isFlags(path)) return Promise.resolve({ items: [FLAG], flagsContinue: false });
      return Promise.reject(new Error(`unhandled: ${path}`));
    });

    renderPage();

    expect(await screen.findByText(FLAG_REASON)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Cross-region flags (1)' })).toBeTruthy();
    expect(screen.queryByText(OPEN_EMPTY)).toBeNull();
    expect(screen.queryByText(WAITING)).toBeNull();
  });
});
