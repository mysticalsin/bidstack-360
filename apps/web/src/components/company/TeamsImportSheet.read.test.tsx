// A paused or in-flight Teams access read has no status yet. The sheet
// said the access did not load. That read has not arrived.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TeamsAccess, TeamsChatSummary } from '@bidstack/shared';

const hookMocks = vi.hoisted(() => ({
  useTeamsAccess: vi.fn(),
  useTeamsChats: vi.fn(),
  useTeamsTeams: vi.fn(),
  useTeamsChannels: vi.fn(),
  useTeamsChannelThreads: vi.fn(),
  useTeamsMessages: vi.fn(),
  useTeamsLinks: vi.fn(),
  useConnectTeams: vi.fn(),
  useImportTeams: vi.fn(),
  useSetTeamsLink: vi.fn(),
}));

vi.mock('@/hooks/useTeamsImport', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/hooks/useTeamsImport')>();
  return { ...real, ...hookMocks };
});

vi.mock('@/components/ui/Toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { TeamsImportSheet } from './TeamsImportSheet';

const COMPANY = '00000000-0000-4000-8000-000000000003';
const CHECKING = 'Checking Teams access. The status has not arrived.';
const FAILED = 'Teams access did not load.';
const EMPTY = 'No Teams access record in this read.';
const CONNECT = 'Connect Microsoft 365';
const EMAIL = 'ada.access@example.test';
const CHAT = 'Northwind kickoff';

function accessRecord(
  state: TeamsAccess['state'],
  accountEmail: string | null = EMAIL,
): TeamsAccess {
  return { state, channels: 'needs_admin_consent', accountEmail };
}

function chat(): TeamsChatSummary {
  return {
    ref: { kind: 'chat', chatId: '19:northwind@thread.v2' },
    title: CHAT,
    subtitle: 'Group chat',
    memberCount: 3,
    lastActivityAt: '2026-11-02T15:00:00.000Z',
    webUrl: null,
    syncLinkId: null,
  };
}

function idleQuery(data?: unknown) {
  return {
    data,
    isLoading: false,
    isFetching: false,
    isError: false,
    status: 'success',
    error: null,
    refetch: vi.fn(),
  };
}

function renderAccess(query: {
  data?: unknown;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  status?: string;
  error?: Error | null;
  refetch?: ReturnType<typeof vi.fn>;
}) {
  const refetch = query.refetch ?? vi.fn();
  hookMocks.useTeamsAccess.mockReturnValue({ ...query, refetch });
  hookMocks.useConnectTeams.mockReturnValue({ mutate: vi.fn(), isPending: false, isError: false });
  hookMocks.useImportTeams.mockReturnValue({ mutate: vi.fn(), isPending: false, isError: false, error: null });
  hookMocks.useSetTeamsLink.mockReturnValue({ mutate: vi.fn(), isPending: false });
  hookMocks.useTeamsLinks.mockReturnValue(idleQuery({ items: [] }));
  hookMocks.useTeamsTeams.mockReturnValue(idleQuery(undefined));
  hookMocks.useTeamsChannels.mockReturnValue(idleQuery(undefined));
  hookMocks.useTeamsChannelThreads.mockReturnValue(idleQuery(undefined));
  hookMocks.useTeamsMessages.mockReturnValue(idleQuery(undefined));
  hookMocks.useTeamsChats.mockReturnValue(idleQuery({ items: [chat()] }));
  render(
    <TeamsImportSheet companyId={COMPANY} companyName="Northwind" open onOpenChange={() => undefined} />,
  );
  return { refetch };
}

function expectNoSettledAccess() {
  expect(screen.queryByText(FAILED)).toBeNull();
  expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  expect(screen.queryByRole('button', { name: CONNECT })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Reconnect with Teams access' })).toBeNull();
  expect(screen.queryByText(EMPTY)).toBeNull();
  expect(screen.queryByText(EMAIL)).toBeNull();
  expect(screen.queryByText(CHAT)).toBeNull();
  expect(screen.queryByPlaceholderText('Search by name')).toBeNull();
  expect(screen.queryAllByRole('alert')).toHaveLength(0);
}

describe('Teams import access read', () => {
  afterEach(() => {
    cleanup();
  });

  it('does not treat a paused access read as a failed load', () => {
    // WHY: a paused first read has isLoading false and no status. The failed
    // copy says the read arrived and broke. This one has not arrived.
    renderAccess({
      data: undefined,
      isLoading: false,
      isFetching: false,
      isError: false,
      status: 'pending',
      error: null,
    });

    expect(screen.getByText(CHECKING)).toBeTruthy();
    expectNoSettledAccess();
  });

  it('does not treat an in-flight access read as a failed load', () => {
    // WHY: a slow read also has no status, and isLoading can stay false.
    // The failed copy must not stand in for a read that is still running.
    renderAccess({
      data: undefined,
      isLoading: false,
      isFetching: true,
      isError: false,
      status: 'pending',
      error: null,
    });

    expect(screen.getByText(CHECKING)).toBeTruthy();
    expectNoSettledAccess();
  });

  it('keeps a failed access read on the error', () => {
    // WHY: a failed read is not an unread pause. Checking must not stand in
    // for the error, and the sheet must not open the chat list.
    const { refetch } = renderAccess({
      data: undefined,
      isLoading: false,
      isFetching: false,
      isError: true,
      status: 'error',
      error: new Error('teams down'),
    });

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByText(CHAT)).toBeNull();
    expect(screen.queryByRole('button', { name: CONNECT })).toBeNull();
  });

  it('lets a failed read win over a stale access record', () => {
    // WHY: error wins before a payload. A refetch failure must not keep the
    // Northwind chat or the saved mailbox on screen.
    renderAccess({
      data: accessRecord('ready'),
      isLoading: false,
      isFetching: false,
      isError: true,
      status: 'error',
      error: new Error('teams down'),
    });

    expect(screen.queryByText(CHAT)).toBeNull();
    expect(screen.queryByText(EMAIL)).toBeNull();
    expect(screen.queryByRole('button', { name: CONNECT })).toBeNull();
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
  });

  it('lets a failed status win when isError is still false', () => {
    // WHY: error wins even when the flag has not flipped. A status of error
    // must not keep the stale chat, and it must not look like a missing grant.
    renderAccess({
      data: accessRecord('ready'),
      isLoading: false,
      isFetching: false,
      isError: false,
      status: 'error',
      error: new Error('teams down'),
    });

    expect(screen.queryByText(CHAT)).toBeNull();
    expect(screen.queryByText(EMAIL)).toBeNull();
    expect(screen.queryByPlaceholderText('Search by name')).toBeNull();
    expect(screen.queryByRole('button', { name: CONNECT })).toBeNull();
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
  });

  it('stays empty when a settled payload is null', () => {
    // WHY: null has arrived. Undefined data is unread. A null payload is not
    // a failed load, and it is not a prompt to connect.
    renderAccess({
      data: null,
      isLoading: false,
      isFetching: false,
      isError: false,
      status: 'success',
      error: null,
    });

    expect(screen.getByText(EMPTY)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByRole('button', { name: CONNECT })).toBeNull();
    expect(screen.queryByText(CHAT)).toBeNull();
    expect(screen.queryByText(EMAIL)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('still asks to connect when a settled read says Microsoft 365 is not connected', () => {
    // WHY: not connected is a payload that arrived. Unread must not replace
    // that settled miss, and the miss must not say the load failed.
    renderAccess({
      data: accessRecord('not_connected', null),
      isLoading: false,
      isFetching: false,
      isError: false,
      status: 'success',
      error: null,
    });

    expect(screen.getByRole('button', { name: CONNECT })).toBeTruthy();
    expect(screen.getByText('Connect Microsoft 365 to import Teams chats.')).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByText(CHAT)).toBeNull();
  });

  it('still shows a loaded chat and the saved mailbox', () => {
    // WHY: a loaded payload stays. The unread line must not replace a chat
    // the access read already allowed.
    renderAccess({
      data: accessRecord('ready'),
      isLoading: false,
      isFetching: false,
      isError: false,
      status: 'success',
      error: null,
    });

    expect(screen.getByText(CHAT)).toBeTruthy();
    expect(screen.getByText(EMAIL)).toBeTruthy();
    expect(screen.getByPlaceholderText('Search by name')).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('still shows a loaded chat when the mailbox is blank', () => {
    // WHY: a blank mailbox is loaded data. Unread must not drop the chat,
    // and the sheet must not invent an address.
    renderAccess({
      data: accessRecord('ready', null),
      isLoading: false,
      isFetching: false,
      isError: false,
      status: 'success',
      error: null,
    });

    expect(screen.getByText(CHAT)).toBeTruthy();
    expect(screen.getByPlaceholderText('Search by name')).toBeTruthy();
    expect(screen.queryByText(EMAIL)).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });
});
