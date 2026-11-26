// A paused or in-flight meetings list has no rows yet. The page used the
// same "No meetings yet" line as a settled empty book. The list has not
// arrived, so it is not empty.
import type { ReactNode } from 'react';

import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  api: apiMock,
}));

import { ApiError } from '@/lib/api';

import MeetingsPage from './MeetingsPage';

const NOT_FOUND = /No meetings yet/;
const WAITING = 'Checking meetings. The list has not arrived.';
const FAILED = "Couldn't load meetings";
const MEETING_TITLE = 'Renewal planning';

const MEETING = {
  id: '22222222-2222-4222-8222-222222222222',
  companyId: '11111111-1111-4111-8111-111111111111',
  companyName: 'Northwind Analytics',
  title: MEETING_TITLE,
  heldAt: '2026-01-15T15:00:00.000Z',
  visibility: 'org' as const,
  sources: ['manual' as const],
  attendeeCount: 3,
  topSeniority: 'director' as const,
  challenges: ['Renewal timing'],
  nextSteps: ['Send the agenda'],
};

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, networkMode: 'online' } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/meetings']}>{children}</MemoryRouter>
      </QueryClientProvider>
    );
  }
  return render(<MeetingsPage />, { wrapper: Wrapper });
}

function hang(): Promise<never> {
  return new Promise(() => {});
}

function isMeetingList(path: string): boolean {
  return path.startsWith('/api/meeting-intel?') || path === '/api/meeting-intel';
}

function route(path: string): Promise<unknown> {
  if (isMeetingList(path)) return Promise.resolve({ items: [], nextCursor: null });
  if (path.startsWith('/api/meeting-intel/flags')) return Promise.resolve({ items: [] });
  if (path === '/api/me/capabilities') {
    return Promise.resolve({
      userId: 'user-1',
      orgId: '11111111-1111-4111-8111-111111111111',
      legacyRole: 'admin',
      roles: ['admin'],
      permissions: ['meetings:write'],
      isAdmin: true,
    });
  }
  return Promise.reject(new Error(`unhandled: ${path}`));
}

describe('MeetingsPage unread list', () => {
  afterEach(() => {
    cleanup();
    apiMock.mockReset();
    onlineManager.setOnline(true);
  });

  it('does not call a paused meetings list an empty book', async () => {
    // WHY: a paused first read has isLoading false and no rows. The page
    // said No meetings yet, while the list has not arrived.
    onlineManager.setOnline(false);
    apiMock.mockImplementation(hang);

    renderPage();

    expect(await screen.findByText(WAITING)).toBeTruthy();
    expect(screen.queryByText(NOT_FOUND)).toBeNull();
  });

  it('does not call an in-flight meetings list an empty book', async () => {
    // WHY: the skeleton alone still sat where a settled empty book would.
    // A slow read is not an empty list.
    onlineManager.setOnline(true);
    apiMock.mockImplementation(hang);

    renderPage();

    expect(await screen.findByText(WAITING)).toBeTruthy();
    expect(screen.queryByText(NOT_FOUND)).toBeNull();
  });

  it('does not call a failed meetings list an empty book', async () => {
    // WHY: a failed read is not evidence the book is empty. The error
    // stays, and the page does not say No meetings yet.
    apiMock.mockImplementation((path: string) => {
      if (isMeetingList(path)) return Promise.reject(new ApiError('network down', 403, {}));
      return route(path);
    });

    renderPage();

    expect(await screen.findByRole('heading', { name: FAILED })).toBeTruthy();
    expect(screen.queryByText(NOT_FOUND)).toBeNull();
    expect(screen.queryByText(WAITING)).toBeNull();
  });

  it('still says a settled list found none', async () => {
    // WHY: a payload that arrived empty is a miss. That line stays
    // No meetings yet, so a real empty book is not dressed up as a slow network.
    apiMock.mockImplementation(route);

    renderPage();

    expect(await screen.findByText(NOT_FOUND)).toBeTruthy();
    expect(screen.queryByText(WAITING)).toBeNull();
  });

  it('still shows a meeting that has arrived', async () => {
    // WHY: a loaded meeting stays on the list. The unread line must not
    // replace a title the read already returned.
    apiMock.mockImplementation((path: string) => {
      if (isMeetingList(path)) return Promise.resolve({ items: [MEETING], nextCursor: null });
      return route(path);
    });

    renderPage();

    expect(await screen.findByText(MEETING_TITLE)).toBeTruthy();
    expect(screen.queryByText(NOT_FOUND)).toBeNull();
    expect(screen.queryByText(WAITING)).toBeNull();
  });
});
