// A paused or in-flight calls list has no rows yet. The page used the
// same "No calls found" title and a 0 call count as a settled empty
// book. The list has not arrived, so it is not an empty book.
import type { ReactNode } from 'react';

import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CallSession } from '@/hooks/useCalls';

const apiMock = vi.hoisted(() => vi.fn());

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (
      _key: string,
      fallback?: string | Record<string, unknown>,
      values?: Record<string, unknown>,
    ) => {
      const template = typeof fallback === 'string' ? fallback : _key;
      const vars = typeof fallback === 'object' && fallback ? fallback : values;
      if (!vars) return template;
      return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(vars[name] ?? ''));
    },
  }),
}));

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  api: apiMock,
}));

import CallsPage from './CallsPage';

const LIST_PATH = '/api/calls?limit=25';
const NOT_FOUND = 'No calls found';
const ZERO = '0 calls';
const WAITING = 'Checking calls. The list has not arrived.';
const FAILED = 'Failed to load calls';
const CALL_PROVIDER = 'ZOOM';

const CALL: CallSession = {
  id: 'call-1',
  orgId: 'org-1',
  userId: 'user-1',
  entityType: 'DEAL',
  entityId: 'deal-1',
  provider: 'ZOOM',
  externalMeetingId: null,
  joinUrl: null,
  scheduledAt: '2026-01-15T15:00:00.000Z',
  startedAt: null,
  endedAt: null,
  durationSec: 1800,
  participantEmails: null,
  recordingUrl: null,
  summary: null,
  actionItems: null,
  sentimentScore: null,
  talkRatio: null,
  status: 'COMPLETED',
  createdAt: '2026-01-15T15:00:00.000Z',
  updatedAt: '2026-01-15T16:00:00.000Z',
};

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, networkMode: 'online' } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return render(<CallsPage />, { wrapper: Wrapper });
}

function hang(): Promise<never> {
  return new Promise(() => {});
}

function isCallsList(path: string): boolean {
  return path === LIST_PATH;
}

describe('CallsPage unread list', () => {
  afterEach(() => {
    cleanup();
    apiMock.mockReset();
    onlineManager.setOnline(true);
  });

  it('does not call a paused calls list an empty book', async () => {
    // WHY: a paused first read has isLoading false and no rows. The page
    // said No calls found and counted 0 calls, while the list has not arrived.
    onlineManager.setOnline(false);
    apiMock.mockImplementation(hang);

    renderPage();

    expect(await screen.findByText(WAITING)).toBeTruthy();
    expect(screen.queryByText(NOT_FOUND)).toBeNull();
    expect(screen.queryByText(ZERO)).toBeNull();
  });

  it('does not call an in-flight calls list an empty book', async () => {
    // WHY: the skeleton alone still sat under a settled empty book. A slow
    // read is not an empty list, and it does not count 0 calls.
    onlineManager.setOnline(true);
    apiMock.mockImplementation(hang);

    renderPage();

    expect(await screen.findByText(WAITING)).toBeTruthy();
    expect(screen.queryByText(NOT_FOUND)).toBeNull();
    expect(screen.queryByText(ZERO)).toBeNull();
  });

  it('does not call a failed calls list an empty book', async () => {
    // WHY: a failed read is not evidence the book is empty. The error
    // stays, and the page does not count 0 calls.
    apiMock.mockImplementation((path: string) => {
      if (isCallsList(path)) return Promise.reject(new Error('network down'));
      return Promise.reject(new Error(`unhandled: ${path}`));
    });

    renderPage();

    expect(await screen.findByRole('heading', { name: FAILED })).toBeTruthy();
    expect(screen.getByText('network down')).toBeTruthy();
    expect(screen.queryByText(NOT_FOUND)).toBeNull();
    expect(screen.queryByText(ZERO)).toBeNull();
    expect(screen.queryByText(WAITING)).toBeNull();
  });

  it('still says a settled list found none', async () => {
    // WHY: a payload that arrived empty is a miss. That line stays
    // No calls found, and the count stays 0, so a real empty book
    // is not dressed up as a slow network.
    apiMock.mockImplementation((path: string) => {
      if (isCallsList(path)) return Promise.resolve({ calls: [], nextCursor: null });
      return Promise.reject(new Error(`unhandled: ${path}`));
    });

    renderPage();

    expect(await screen.findByText(NOT_FOUND)).toBeTruthy();
    expect(screen.getByText(ZERO)).toBeTruthy();
    expect(screen.queryByText(WAITING)).toBeNull();
  });

  it('still shows a call that has arrived', async () => {
    // WHY: a loaded call stays on the list. The unread line must not
    // replace a provider the read already returned.
    apiMock.mockImplementation((path: string) => {
      if (isCallsList(path)) return Promise.resolve({ calls: [CALL], nextCursor: null });
      return Promise.reject(new Error(`unhandled: ${path}`));
    });

    renderPage();

    expect(await screen.findByText(CALL_PROVIDER)).toBeTruthy();
    expect(screen.getByText('1 call')).toBeTruthy();
    expect(screen.queryByText(NOT_FOUND)).toBeNull();
    expect(screen.queryByText(WAITING)).toBeNull();
  });
});
