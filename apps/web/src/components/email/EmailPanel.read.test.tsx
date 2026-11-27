// A paused or in-flight mailbox read has no threads yet. The panel said
// there was no email. That read has not arrived.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const hookMocks = vi.hoisted(() => ({
  useInfiniteQuery: vi.fn(),
}));

vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query');
  return { ...actual, useInfiniteQuery: hookMocks.useInfiniteQuery };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));

vi.mock('./DraftComposer', () => ({
  DraftComposer: () => null,
}));

vi.mock('./EmailThreadView', () => ({
  EmailThreadView: () => null,
}));

import { EmailPanel } from './EmailPanel';

const CHECKING = 'Checking email. The list has not arrived.';
const FAILED = 'Could not load email';
const EMPTY = 'No email yet';
const SUBJECT = 'Northwind printer quote';
const FROM = 'ada@northwind.example';
const CONTACT = '11111111-1111-4111-8111-111111111111';

function thread(subject: string) {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    orgId: CONTACT,
    userId: CONTACT,
    provider: 'GMAIL',
    externalMessageId: 'm1',
    threadId: 't1',
    fromEmail: FROM,
    toEmails: [{ email: 'rep@example.test' }],
    ccEmails: [],
    subject,
    bodyText: 'The quote is attached.',
    isOutbound: false,
    sentAt: '2026-11-05T15:00:00.000Z',
    receivedAt: '2026-11-05T15:00:00.000Z',
    openedAt: null,
    clickedAt: null,
    entityType: null,
    entityId: null,
    contactId: CONTACT,
    createdAt: '2026-11-05T15:00:00.000Z',
  };
}

function pages(messages: ReturnType<typeof thread>[]) {
  return {
    pages: [{ messages, total: messages.length, hasMore: false }],
    pageParams: [1],
  };
}

function renderPanel(query: {
  data?: unknown;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  status?: string;
  error?: Error | null;
}) {
  hookMocks.useInfiniteQuery.mockReturnValue({
    ...query,
    error: query.error ?? null,
    refetch: vi.fn(),
    hasNextPage: false,
    isFetchNextPageError: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
  });
  render(<EmailPanel filter={{ contactId: CONTACT }} />);
}

describe('EmailPanel mailbox read', () => {
  afterEach(() => {
    cleanup();
  });

  it('does not treat a paused mailbox as an empty inbox', () => {
    // WHY: a paused first read has isLoading false and no threads. No email
    // yet says the list arrived. This one has not.
    renderPanel({
      data: undefined,
      isLoading: false,
      isFetching: false,
      isError: false,
      status: 'pending',
      error: null,
    });

    expect(screen.getByText(CHECKING)).toBeTruthy();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByText(SUBJECT)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('does not treat an in-flight mailbox as an empty inbox', () => {
    // WHY: a slow read also has no threads, and isLoading can stay false.
    // No email yet must not stand in for a read that is still running.
    renderPanel({
      data: undefined,
      isLoading: false,
      isFetching: true,
      isError: false,
      status: 'pending',
      error: null,
    });

    expect(screen.getByText(CHECKING)).toBeTruthy();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByText(SUBJECT)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('keeps a failed mailbox on the error', () => {
    // WHY: a failed read is not an unread pause. Checking must not stand in
    // for the error, and No email yet must not open.
    renderPanel({
      data: undefined,
      isLoading: false,
      isFetching: false,
      isError: true,
      status: 'error',
      error: new Error('mail down'),
    });

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByText(SUBJECT)).toBeNull();
  });

  it('lets a failed read win over a stale thread', () => {
    // WHY: error wins before a payload. A refetch failure must not keep the
    // thread that was already on screen.
    renderPanel({
      data: pages([thread(SUBJECT)]),
      isLoading: false,
      isFetching: false,
      isError: true,
      status: 'error',
      error: new Error('mail down'),
    });

    expect(screen.queryByText(SUBJECT)).toBeNull();
    expect(screen.queryByText(FROM)).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
  });

  it('lets a failed status win when isError is still false', () => {
    // WHY: error wins even when the flag has not flipped. A status of error
    // must not keep the stale thread, and it must not look like an empty inbox.
    renderPanel({
      data: pages([thread(SUBJECT)]),
      isLoading: false,
      isFetching: false,
      isError: false,
      status: 'error',
      error: null,
    });

    expect(screen.queryByText(SUBJECT)).toBeNull();
    expect(screen.queryByText(FROM)).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
  });

  it('stays on no email when a settled payload is null', () => {
    // WHY: null has arrived. Undefined data is unread. A null payload is not
    // a failed load, and it is not still checking.
    renderPanel({
      data: null,
      isLoading: false,
      isFetching: false,
      isError: false,
      status: 'success',
      error: null,
    });

    expect(screen.getByText(EMPTY)).toBeTruthy();
    expect(screen.queryByText(SUBJECT)).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('stays on no email when a settled list is empty', () => {
    // WHY: an empty list has arrived. Unread must not replace that settled
    // miss, and the miss must not say the load failed.
    renderPanel({
      data: pages([]),
      isLoading: false,
      isFetching: false,
      isError: false,
      status: 'success',
      error: null,
    });

    expect(screen.getByText(EMPTY)).toBeTruthy();
    expect(screen.queryByText(SUBJECT)).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('still shows a loaded thread when the subject is blank', () => {
    // WHY: a loaded thread stays. A blank subject is loaded data. Unread must
    // not drop the thread, and the row must not invent a subject.
    renderPanel({
      data: pages([thread('')]),
      isLoading: false,
      isFetching: false,
      isError: false,
      status: 'success',
      error: null,
    });

    expect(screen.getByText('(no subject)')).toBeTruthy();
    expect(screen.getByText(FROM)).toBeTruthy();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('still shows a loaded thread and its subject', () => {
    // WHY: a loaded payload stays. The unread line must not replace a thread
    // the read already returned.
    renderPanel({
      data: pages([thread(SUBJECT)]),
      isLoading: false,
      isFetching: false,
      isError: false,
      status: 'success',
      error: null,
    });

    expect(screen.getByText(SUBJECT)).toBeTruthy();
    expect(screen.getByText(FROM)).toBeTruthy();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });
});
