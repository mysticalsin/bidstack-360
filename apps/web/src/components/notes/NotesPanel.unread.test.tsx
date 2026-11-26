// The account notes list is the list. Each row is the note detail.
// A paused read leaves isLoading false and no payload. That is not an
// empty account. A failed read has no payload either. "No notes yet" and
// "Unknown error" belong to a payload that arrived.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Note } from '@bidstack/shared';

const hookMocks = vi.hoisted(() => ({
  useNotes: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => (typeof fallback === 'string' ? fallback : key),
  }),
}));

vi.mock('./MeetingNotesImportDialog', () => ({
  MeetingNotesImportDialog: () => null,
}));

vi.mock('@/hooks/useNotes', () => ({
  useNotes: hookMocks.useNotes,
  useCreateNote: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteNote: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateNote: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
}));

import { NotesPanel } from './NotesPanel';

const CHECKING = 'Checking notes. They have not arrived.';
const FAILED = 'Could not load notes. The notes have not arrived.';
const EMPTY = 'No notes yet';
const UNKNOWN_ERROR = 'Unknown error';

const NOTE: Note = {
  id: '00000000-0000-4000-8000-000000000364',
  accountId: 'acct-sample',
  title: 'Kickoff debrief',
  bodyMd: 'Sample reader captured the kickoff.',
  pinned: false,
  authorUserId: '00000000-0000-4000-8000-000000000001',
  authorEmail: 'ada@example.com',
  createdAt: '2026-06-01T12:00:00.000Z',
  updatedAt: '2026-06-01T12:00:00.000Z',
};

function mockList(value: {
  data?: { items: Note[] };
  isLoading: boolean;
  isPending: boolean;
  isError: boolean;
  error: unknown;
}) {
  hookMocks.useNotes.mockReturnValue(value);
}

function renderPanel(accountId: string | undefined) {
  return render(<NotesPanel accountId={accountId} companyName="Sample Co" domain="example.com" />);
}

describe('Notes list when the payload has not arrived', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('does not call an unread notes list empty', () => {
    // WHY: a paused read has isLoading false and no items. "No notes yet"
    // tells a reader the account was checked and has nothing.
    mockList({
      data: undefined,
      isLoading: false,
      isPending: true,
      isError: false,
      error: null,
    });

    renderPanel('acct-sample');

    expect(screen.getByText(CHECKING)).toBeTruthy();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByText(UNKNOWN_ERROR)).toBeNull();
    expect(screen.queryByText(NOTE.title)).toBeNull();
  });

  it('does not call a failed notes read empty or unknown', () => {
    // WHY: a failed read has not delivered the list or a note detail.
    // "Unknown error" and "No notes yet" both read as a settled answer.
    mockList({
      data: undefined,
      isLoading: false,
      isPending: false,
      isError: true,
      error: 'notes read failed',
    });

    renderPanel('acct-sample');

    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByText(UNKNOWN_ERROR)).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
  });

  it('does not call a loading notes list empty', () => {
    // WHY: the first fetch is still in flight. A skeleton is not an empty account.
    mockList({
      data: undefined,
      isLoading: true,
      isPending: true,
      isError: false,
      error: null,
    });

    renderPanel('acct-sample');

    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByText(UNKNOWN_ERROR)).toBeNull();
    expect(screen.queryByText(NOTE.title)).toBeNull();
  });

  it('still says the list is empty after an empty payload arrives', () => {
    // WHY: empty is honest only after the list payload landed with no notes.
    mockList({
      data: { items: [] },
      isLoading: false,
      isPending: false,
      isError: false,
      error: null,
    });

    renderPanel('acct-sample');

    expect(screen.getByText(EMPTY)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
  });

  it('still shows a note detail that has arrived', () => {
    // WHY: the row is the note detail. A payload that arrived keeps the title,
    // the body, and the author. It does not say the list is still unread.
    mockList({
      data: { items: [NOTE] },
      isLoading: false,
      isPending: false,
      isError: false,
      error: null,
    });

    renderPanel('acct-sample');

    expect(screen.getByRole('heading', { name: NOTE.title })).toBeTruthy();
    expect(screen.getByText('Sample reader captured the kickoff.')).toBeTruthy();
    expect(screen.getByText(/ada@example.com/)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
  });

  it('still asks for an account when none is selected', () => {
    // WHY: no account is not an unread list and not an empty list.
    mockList({
      data: undefined,
      isLoading: false,
      isPending: true,
      isError: false,
      error: null,
    });

    renderPanel(undefined);

    expect(screen.getByText('Select an account to view notes')).toBeTruthy();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
  });
});
