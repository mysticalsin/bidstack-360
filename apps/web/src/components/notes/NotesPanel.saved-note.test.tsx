// WHY: the cockpit notes list only reloads after a save. On a demo account
// the reload still has the previous empty page, so the panel says "No notes
// yet" under a note the save just returned (the MAPFRE steering debrief).
// The sentence the user saved has to stay on screen without that refetch.

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Note } from '@bidstack/shared';

const MAPFRE = '11111111-1111-4111-8111-111111111111';
const STEERING =
  'The MAPFRE CIO office said our delivery quality is better than Accenture on the claims platform.';

const saved: Note = {
  id: '22222222-2222-4222-8222-222222222222',
  accountId: MAPFRE,
  companyId: MAPFRE,
  title: 'Sample: MAPFRE IT steering debrief',
  bodyMd: STEERING,
  pinned: false,
  authorUserId: '33333333-3333-4333-8333-333333333333',
  authorEmail: 'ada@example.com',
  createdAt: '2026-11-05T00:00:00.000Z',
  updatedAt: '2026-11-05T00:00:00.000Z',
};

const mutateAsync = vi.fn(async () => saved);

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}));

vi.mock('@/hooks/useNotes', () => ({
  useNotes: () => ({
    isLoading: false,
    isError: false,
    data: { items: [] },
  }),
  useCreateNote: () => ({ mutateAsync, isPending: false }),
  useUpdateNote: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  useDeleteNote: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('./MeetingNotesImportDialog', () => ({
  MeetingNotesImportDialog: () => null,
}));

import { NotesPanel } from './NotesPanel';

afterEach(() => {
  cleanup();
  mutateAsync.mockClear();
});

describe('NotesPanel saved note', () => {
  it('keeps the note the save returned when the list is still the empty demo page', async () => {
    render(<NotesPanel accountId={MAPFRE} companyName="MAPFRE" />);

    fireEvent.click(screen.getByRole('button', { name: '+ Add' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Note title' }), {
      target: { value: saved.title },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Note body' }), {
      target: { value: STEERING },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add note' }));

    expect(await screen.findByRole('heading', { name: saved.title })).toBeTruthy();
    expect(screen.getByText(STEERING)).toBeTruthy();
    expect(screen.queryByText('No notes yet')).toBeNull();
    expect(mutateAsync).toHaveBeenCalledOnce();
  });
});
