// A paused, idle, or in-flight flag read has no payload yet. The page used
// the same empty sentence as a settled list. The flags have not arrived,
// so that sentence is not a finding.
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/hooks/useMeetingIntel', () => ({
  useMeetingFlags: vi.fn(),
  useDismissFlag: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { useMeetingFlags } from '@/hooks/useMeetingIntel';

import MeetingFlagsPage from './MeetingFlagsPage';

const CHECKING = 'Checking flags. The list has not arrived.';
const EMPTY = 'No open flags. When a colleague meets someone at a sister account, it shows up here.';
const FAILED = "Couldn't load flags";
const REASON = 'Sample sister account met a buyer';

const FLAG = {
  id: '11111111-1111-4111-8111-111111111111',
  meetingId: '22222222-2222-4222-8222-222222222222',
  parentCompanyId: '33333333-3333-4333-8333-333333333333',
  parentCompanyName: 'Sample Group',
  companyName: 'Sample Sister',
  companyRestricted: false,
  ownedCompanyId: '44444444-4444-4444-8444-444444444444',
  ownedCompanyName: 'Sample Account',
  reason: REASON,
  talkingPoints: ['Ask about the sample visit'],
  status: 'open' as const,
  createdAt: '2026-11-01T15:00:00.000Z',
};

type FlagsQuery = ReturnType<typeof useMeetingFlags>;

function show(partial: Partial<FlagsQuery>) {
  vi.mocked(useMeetingFlags).mockReturnValue({
    data: undefined,
    isError: false,
    isLoading: false,
    status: 'pending',
    fetchStatus: 'paused',
    refetch: vi.fn(),
    ...partial,
  } as FlagsQuery);
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/meetings/flags']}>
      <MeetingFlagsPage />
    </MemoryRouter>,
  );
}

function expectNoSettledFinding() {
  expect(screen.queryByText(EMPTY)).toBeNull();
  expect(screen.queryByText('Nothing dismissed.')).toBeNull();
  expect(screen.queryByText(REASON)).toBeNull();
  expect(screen.queryByText(FAILED)).toBeNull();
}

describe('MeetingFlagsPage unread list', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(useMeetingFlags).mockReset();
  });

  it('does not call a paused flag read an empty list', async () => {
    // WHY: a paused first read has isLoading false and no payload. The page
    // said there are no open flags, while the flags have not arrived.
    show({ data: undefined, isError: false, isLoading: false, status: 'pending', fetchStatus: 'paused' });
    renderPage();

    expect(await screen.findByText(CHECKING)).toBeTruthy();
    expectNoSettledFinding();
  });

  it('does not call an unread idle flag read an empty list', async () => {
    // WHY: a read that has not started is pending and idle. isLoading is
    // false, so the page said there are no open flags before any payload.
    show({ data: undefined, isError: false, isLoading: false, status: 'pending', fetchStatus: 'idle' });
    renderPage();

    expect(await screen.findByText(CHECKING)).toBeTruthy();
    expectNoSettledFinding();
  });

  it('does not call an in-flight flag read an empty list', async () => {
    // WHY: a slow read showed only a skeleton. A list that has not arrived
    // is not an account with no open flags.
    show({ data: undefined, isError: false, isLoading: true, status: 'pending', fetchStatus: 'fetching' });
    renderPage();

    expect(await screen.findByText(CHECKING)).toBeTruthy();
    expectNoSettledFinding();
  });

  it('does not call a failed flag read an empty list', async () => {
    // WHY: a failed read is not evidence that there are no open flags.
    // The error stays, and the page does not say the list is empty.
    show({ data: undefined, isError: true, isLoading: false, status: 'error', fetchStatus: 'idle' });
    renderPage();

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByText(REASON)).toBeNull();
  });

  it('still shows a settled list that has no open flags', async () => {
    // WHY: a list that arrived with no open flags is empty. That sentence
    // stays, so a real empty list is not dressed up as a slow network.
    show({
      data: { items: [] },
      isError: false,
      isLoading: false,
      status: 'success',
      fetchStatus: 'idle',
    });
    renderPage();

    expect(await screen.findByText(EMPTY)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(REASON)).toBeNull();
  });

  it('still shows a flag that has arrived', async () => {
    // WHY: a loaded flag stays on the list. The unread line must not
    // replace a flag the read already returned.
    show({
      data: { items: [FLAG] },
      isError: false,
      isLoading: false,
      status: 'success',
      fetchStatus: 'idle',
    });
    renderPage();

    expect(await screen.findByText(REASON)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
