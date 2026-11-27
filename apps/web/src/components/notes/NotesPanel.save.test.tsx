import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Note } from '@bidstack/shared';

import '@/i18n';
import { NotesPanel } from './NotesPanel';
import { useNotes } from '@/hooks/useNotes';

// The cockpit account id is the company id. A save that omits it never
// lands on the company Notes tab, which then stays on "No notes yet".
const ACCOUNT_ID = '11111111-1111-4111-8111-111111111111';

const createNote = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/useNotes', () => ({
  useNotes: vi.fn(),
  useCreateNote: vi.fn(() => ({ mutateAsync: createNote, isPending: false })),
  useUpdateNote: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })),
  useDeleteNote: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useImportMeetingNotes: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
}));

vi.mock('./MeetingNotesImportDialog', () => ({
  MeetingNotesImportDialog: () => null,
}));

function note(partial: Partial<Note> & Pick<Note, 'id' | 'title' | 'bodyMd'>): Note {
  return {
    accountId: ACCOUNT_ID,
    companyId: ACCOUNT_ID,
    pinned: false,
    authorUserId: '22222222-2222-4222-8222-222222222222',
    authorEmail: 'ada@example.com',
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    ...partial,
  };
}

const DEMO_BODY =
  'The MAPFRE CIO office said our delivery quality is better than Accenture on the claims platform. Our squads were faster to staff than Accenture.';

function mockNotes(items: Note[]) {
  vi.mocked(useNotes).mockReturnValue({
    isLoading: false,
    isError: false,
    data: { items },
  } as ReturnType<typeof useNotes>);
}

describe('NotesPanel empty save line', () => {
  afterEach(() => {
    cleanup();
    createNote.mockReset();
  });

  it('shows a demo sample sentence and does not draw a blank line for a whitespace body', () => {
    // A title-only note used to keep an empty preview row under the title.
    // That row reads as a broken note. The seeded MAPFRE sentence is real
    // text and has to stay on the row.
    mockNotes([
      note({
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        title: 'Sample: MAPFRE IT steering debrief',
        bodyMd: DEMO_BODY,
      }),
      note({
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        title: 'Title only',
        bodyMd: '   \n  ',
      }),
    ]);

    const { container } = render(<NotesPanel accountId={ACCOUNT_ID} companyName="MAPFRE" />);

    expect(screen.getByText('Sample: MAPFRE IT steering debrief')).toBeTruthy();
    expect(screen.getByText(DEMO_BODY)).toBeTruthy();
    expect(screen.getByText('Title only')).toBeTruthy();
    expect(screen.queryByText('No notes yet')).toBeNull();
    const blanks = [...container.querySelectorAll('.line-clamp-3')].filter(
      (el) => (el.textContent ?? '').trim() === '',
    );
    expect(blanks).toHaveLength(0);
  });

  it('keeps the saved title on screen and files the note on the company', async () => {
    // The list refetch has not come back. Closing the editor used to fall
    // through to "No notes yet" after a successful save. Whitespace in the
    // body is not a body. The account id is the company id, so the create
    // has to send it or the company tab still says there are no notes.
    mockNotes([]);
    createNote.mockImplementation(
      async (input: { title: string; bodyMd: string; companyId?: string }) =>
        note({
          id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          title: input.title,
          bodyMd: input.bodyMd,
          companyId: input.companyId,
        }),
    );

    render(<NotesPanel accountId={ACCOUNT_ID} companyName="MAPFRE" />);
    fireEvent.click(screen.getByRole('button', { name: '+ Add' }));
    fireEvent.change(screen.getByLabelText('Note title'), { target: { value: 'Follow-up' } });
    fireEvent.change(screen.getByLabelText('Note body'), { target: { value: '   \n  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add note' }));

    await waitFor(() => expect(createNote).toHaveBeenCalled());
    expect(createNote).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Follow-up',
        bodyMd: '',
        companyId: ACCOUNT_ID,
        pinned: false,
      }),
    );
    expect(await screen.findByText('Follow-up')).toBeTruthy();
    expect(screen.queryByText('No notes yet')).toBeNull();
    expect(document.querySelector('.line-clamp-3')).toBeNull();
  });
});
