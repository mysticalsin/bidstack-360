import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TeamsAccess, TeamsThreadMessages } from '@bidstack/shared';

import { ApiError } from '@/lib/api';

vi.mock('@/hooks/useTeamsImport', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/hooks/useTeamsImport')>();
  return {
    ...real,
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
  };
});

vi.mock('@/components/ui/Toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import {
  useConnectTeams,
  useImportTeams,
  useSetTeamsLink,
  useTeamsAccess,
  useTeamsChannelThreads,
  useTeamsChannels,
  useTeamsChats,
  useTeamsLinks,
  useTeamsMessages,
  useTeamsTeams,
} from '@/hooks/useTeamsImport';

import { TeamsImportSheet } from './TeamsImportSheet';

const ACME = '00000000-0000-4000-8000-000000000003';
const GLOBEX = '00000000-0000-4000-8000-000000000004';
const CHAT_REF = { kind: 'chat' as const, chatId: '19:acme@thread.v2' };
const connect = vi.fn();
const importMutate = vi.fn();

const q = <T,>(data: T | undefined, over: Record<string, unknown> = {}) =>
  ({ data, isLoading: false, isError: false, error: null, refetch: vi.fn(), ...over }) as never;

function access(state: TeamsAccess['state'], channels: TeamsAccess['channels'] = 'needs_admin_consent') {
  vi.mocked(useTeamsAccess).mockReturnValue(q<TeamsAccess>({ state, channels, accountEmail: 'tony@mantu.com' }));
}

const MESSAGES: TeamsThreadMessages = {
  title: 'Chat with Jane Doe',
  participantCount: 2,
  items: [
    {
      id: 'm1',
      authorName: 'Tony',
      createdAt: '2026-11-07T14:00:00.000Z',
      preview: 'Sending the scope',
      attachmentNames: [],
      webUrl: null,
      filed: true,
    },
    {
      id: 'm2',
      authorName: 'Jane Doe',
      createdAt: '2026-11-07T15:00:00.000Z',
      preview: 'Scope looks good',
      attachmentNames: ['Scope.docx'],
      webUrl: 'https://teams.microsoft.com/l/message/x/m2',
      filed: false,
    },
  ],
  suggestions: [{ companyId: GLOBEX, name: 'Globex', reason: 'domain', match: 'globex.io' }],
};

beforeEach(() => {
  vi.mocked(useConnectTeams).mockReturnValue({ mutate: connect, isPending: false, isError: false } as never);
  vi.mocked(useImportTeams).mockReturnValue({ mutate: importMutate, isPending: false, isError: false, error: null } as never);
  vi.mocked(useSetTeamsLink).mockReturnValue({ mutate: vi.fn(), isPending: false } as never);
  vi.mocked(useTeamsLinks).mockReturnValue(q({ items: [] }));
  vi.mocked(useTeamsTeams).mockReturnValue(q(undefined));
  vi.mocked(useTeamsChannels).mockReturnValue(q(undefined));
  vi.mocked(useTeamsChannelThreads).mockReturnValue(q(undefined));
  vi.mocked(useTeamsChats).mockReturnValue(
    q({
      items: [
        {
          ref: CHAT_REF,
          title: 'Chat with Jane Doe',
          subtitle: 'Group chat',
          memberCount: 2,
          lastActivityAt: '2026-11-07T15:00:00.000Z',
          webUrl: null,
          syncLinkId: null,
        },
      ],
    }),
  );
  vi.mocked(useTeamsMessages).mockReturnValue(q(MESSAGES));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const renderSheet = () =>
  render(<TeamsImportSheet companyId={ACME} companyName="Acme" open onOpenChange={() => undefined} />);

describe('TeamsImportSheet', () => {
  it('asks to reconnect when the grant lacks Teams access', () => {
    access('needs_consent');
    renderSheet();
    const prompt = screen.getByTestId('teams-consent');
    expect(prompt.textContent).toContain('Polo needs permission to read your Teams chats');
    fireEvent.click(within(prompt).getByRole('button', { name: 'Reconnect with Teams access' }));
    expect(connect).toHaveBeenCalled();
    expect(useTeamsChats).not.toHaveBeenCalled();
  });

  it('offers to connect when Microsoft 365 is not connected', () => {
    access('not_connected');
    renderSheet();
    expect(screen.getByRole('button', { name: 'Connect Microsoft 365' })).toBeTruthy();
  });

  it('shows the reconnect prompt when Graph refuses the chat list', () => {
    access('ready');
    vi.mocked(useTeamsChats).mockReturnValue(
      q(undefined, {
        isError: true,
        error: new ApiError('Conflict', 409, { code: 'teams_consent_required', message: 'x' }),
      }),
    );
    renderSheet();
    expect(screen.getByTestId('teams-consent')).toBeTruthy();
  });

  it('files the picked messages to the account, filed ones locked', () => {
    access('ready');
    renderSheet();
    fireEvent.click(screen.getByRole('button', { name: /Chat with Jane Doe/ }));
    const list = screen.getByTestId('teams-message-list');
    const boxes = within(list).getAllByRole('checkbox');
    expect((boxes[0] as HTMLInputElement).disabled).toBe(true);
    expect(within(list).getByText('Filed')).toBeTruthy();
    expect(within(list).getByText('Scope.docx')).toBeTruthy();
    const fileButton = screen.getByRole('button', { name: 'File 0 messages' });
    expect((fileButton as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(boxes[1]!);
    fireEvent.click(screen.getByRole('button', { name: 'File 1 message' }));
    expect(importMutate.mock.calls[0]![0]).toEqual({
      ref: CHAT_REF,
      companyId: ACME,
      messageIds: ['m2'],
      keepSyncing: false,
    });
  });

  it('suggests the matching account and lets the person switch to it, with ongoing sync', () => {
    access('ready');
    renderSheet();
    fireEvent.click(screen.getByRole('button', { name: /Chat with Jane Doe/ }));
    expect(screen.getByTestId('teams-suggestion').textContent).toContain('Participants match Globex (domain globex.io)');
    fireEvent.click(screen.getByRole('button', { name: 'Use Globex' }));
    expect((screen.getByLabelText('File to') as HTMLSelectElement).value).toBe(GLOBEX);
    fireEvent.click(screen.getByRole('switch', { name: /Keep filing new messages from this chat to Globex/ }));
    fireEvent.click(screen.getByLabelText('Select all'));
    fireEvent.click(screen.getByRole('button', { name: 'File 1 message' }));
    expect(importMutate.mock.calls[0]![0]).toEqual({
      ref: CHAT_REF,
      companyId: GLOBEX,
      messageIds: ['m2'],
      keepSyncing: true,
    });
  });

  it('can link a chat for sync without filing old messages', () => {
    access('ready');
    renderSheet();
    fireEvent.click(screen.getByRole('button', { name: /Chat with Jane Doe/ }));
    fireEvent.click(screen.getByRole('switch'));
    fireEvent.click(screen.getByRole('button', { name: 'Keep syncing' }));
    expect(importMutate.mock.calls[0]![0]).toMatchObject({ messageIds: [], keepSyncing: true });
  });

  it('explains channel threads need admin approval', () => {
    access('ready', 'needs_admin_consent');
    renderSheet();
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Channels' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Channels' }));
    expect(screen.getByText('Channel threads need an admin to approve Teams channel access.')).toBeTruthy();
  });
});
