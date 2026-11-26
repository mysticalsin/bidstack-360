// A paused or in-flight conversation read has no list yet. The section
// said the conversations did not load. That read has not arrived.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const hookMocks = vi.hoisted(() => ({
  useAccountConversations: vi.fn(),
  useRefileMeeting: vi.fn(),
}));

vi.mock('@/hooks/useAccountConversations', () => ({
  useAccountConversations: hookMocks.useAccountConversations,
  useRefileMeeting: hookMocks.useRefileMeeting,
}));

vi.mock('@/hooks/useCapabilities', () => ({
  useHasPermission: () => true,
}));

import { AccountConversations } from './AccountConversations';

const COMPANY = '00000000-0000-4000-8000-000000000003';
const CHECKING = 'Checking conversations. The list has not arrived.';
const FAILED = 'Conversations did not load.';
const EMPTY = 'No synced meetings or emails yet.';
const IMPORT = 'Import from Teams';
const SUBJECT = 'Northwind kickoff';
const CAPTION = 'From your connected Outlook and Google calendars and mailboxes';

function conversation(subject: string) {
  return {
    id: '00000000-0000-4000-8000-000000000101',
    type: 'meeting' as const,
    subject,
    occurredAt: '2026-11-02T15:00:00.000Z',
    endAt: '2026-11-02T16:00:00.000Z',
    status: 'completed' as const,
    direction: null,
    participantCount: 3,
    source: 'teams' as const,
    sourceLabel: 'Teams',
    channel: 'teams' as const,
    filing: 'automatic' as const,
    needsOpportunity: false,
    opportunity: null,
    sourceRecord: null,
    canRefile: false,
  };
}

function pages(items: ReturnType<typeof conversation>[]) {
  return {
    pages: [
      {
        companyId: COMPANY,
        items,
        nextCursor: null,
        openOpportunities: [] as Array<{ id: string; name: string }>,
      },
    ],
    pageParams: [null],
  };
}

function renderConversations(query: {
  data?: unknown;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  status?: string;
  error?: Error | null;
}) {
  hookMocks.useAccountConversations.mockReturnValue({
    ...query,
    hasNextPage: false,
    isFetchingNextPage: false,
    refetch: vi.fn(),
    fetchNextPage: vi.fn(),
  });
  hookMocks.useRefileMeeting.mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
    isError: false,
  });
  render(<AccountConversations companyId={COMPANY} companyName="Northwind" />);
}

describe('AccountConversations read', () => {
  afterEach(() => {
    cleanup();
  });

  it('does not treat a paused conversation read as a failed load', () => {
    // WHY: a paused first read has isLoading false and no list. The failed
    // copy says the read arrived and broke. This one has not arrived.
    renderConversations({
      data: undefined,
      isLoading: false,
      isFetching: false,
      isError: false,
      status: 'pending',
      error: null,
    });

    expect(screen.getByText(CHECKING)).toBeTruthy();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByRole('button', { name: IMPORT })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Conversations' })).toBeNull();
    expect(screen.queryByText(CAPTION)).toBeNull();
    expect(screen.queryByText(SUBJECT)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('does not treat an in-flight conversation read as a failed load', () => {
    // WHY: a slow read also has no list, and isLoading can stay false.
    // The failed copy must not stand in for a read that is still running.
    renderConversations({
      data: undefined,
      isLoading: false,
      isFetching: true,
      isError: false,
      status: 'pending',
      error: null,
    });

    expect(screen.getByText(CHECKING)).toBeTruthy();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByRole('button', { name: IMPORT })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Conversations' })).toBeNull();
    expect(screen.queryByText(CAPTION)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('keeps a failed conversation read on the error', () => {
    // WHY: a failed read is not an unread pause. Checking must not stand in
    // for the error, and the list must not open.
    renderConversations({
      data: undefined,
      isLoading: false,
      isFetching: false,
      isError: true,
      status: 'error',
      error: new Error('conversations down'),
    });

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByText(SUBJECT)).toBeNull();
  });

  it('lets a failed read win over a stale conversation', () => {
    // WHY: error wins before a payload. A refetch failure must not keep
    // Northwind kickoff on screen.
    renderConversations({
      data: pages([conversation(SUBJECT)]),
      isLoading: false,
      isFetching: false,
      isError: true,
      status: 'error',
      error: new Error('conversations down'),
    });

    expect(screen.queryByText(SUBJECT)).toBeNull();
    expect(screen.queryByRole('button', { name: IMPORT })).toBeNull();
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
  });

  it('lets a failed status win when isError is still false', () => {
    // WHY: error wins even when the flag has not flipped. A status of error
    // must not keep the stale conversation, and it must not look like an empty list.
    renderConversations({
      data: pages([conversation(SUBJECT)]),
      isLoading: false,
      isFetching: false,
      isError: false,
      status: 'error',
      error: new Error('conversations down'),
    });

    expect(screen.queryByText(SUBJECT)).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByRole('button', { name: IMPORT })).toBeNull();
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
  });

  it('stays empty when a settled payload is null', () => {
    // WHY: null has arrived. Undefined data is unread. A null payload is not
    // a failed load, and it is not still checking.
    renderConversations({
      data: null,
      isLoading: false,
      isFetching: false,
      isError: false,
      status: 'success',
      error: null,
    });

    expect(screen.getByText(EMPTY)).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Conversations' })).toBeTruthy();
    expect(screen.getByRole('button', { name: IMPORT })).toBeTruthy();
    expect(screen.queryByText(SUBJECT)).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('stays empty when a settled list has no conversations', () => {
    // WHY: an empty list has arrived. Unread must not replace that settled
    // miss, and the miss must not say the load failed.
    renderConversations({
      data: pages([]),
      isLoading: false,
      isFetching: false,
      isError: false,
      status: 'success',
      error: null,
    });

    expect(screen.getByText(EMPTY)).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Conversations' })).toBeTruthy();
    expect(screen.getByRole('button', { name: IMPORT })).toBeTruthy();
    expect(screen.queryByText(SUBJECT)).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('still shows a loaded conversation', () => {
    // WHY: a loaded payload stays. The unread line must not replace a
    // conversation the read already returned.
    renderConversations({
      data: pages([conversation(SUBJECT)]),
      isLoading: false,
      isFetching: false,
      isError: false,
      status: 'success',
      error: null,
    });

    expect(screen.getByText(SUBJECT)).toBeTruthy();
    expect(screen.getByText('Teams')).toBeTruthy();
    expect(screen.getByText(/3 people/)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('still shows a loaded conversation with a blank subject', () => {
    // WHY: a blank subject is loaded data. Unread must not drop the row,
    // and the row must not invent a subject.
    renderConversations({
      data: pages([conversation('')]),
      isLoading: false,
      isFetching: false,
      isError: false,
      status: 'success',
      error: null,
    });

    expect(screen.getByText('Teams')).toBeTruthy();
    expect(screen.getByText(/3 people/)).toBeTruthy();
    expect(screen.queryByText(SUBJECT)).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });
});
