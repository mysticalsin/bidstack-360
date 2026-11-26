// WHY: the live notes section invited writing before the Y.Doc arrived, and
// again when the server rejected the read. That invitation is an empty note.
// A connected empty document may still invite writing. A note already on the
// pad stays.
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const phase = vi.hoisted(() => ({ current: 'checking' as 'checking' | 'failed' | 'ready' }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}));

vi.mock('@/lib/auth', () => ({
  useUser: () => ({ user: { id: 'user-1', fullName: 'Ada' } }),
}));

vi.mock('@/hooks/useCollabNotesRead', () => ({
  useCollabNotesRead: () => phase.current,
}));

vi.mock('./CollaborativeRichTextEditor', () => ({
  CollaborativeRichTextEditor: ({ placeholder }: { placeholder?: string }) => (
    <div data-testid="collab-editor">{placeholder}</div>
  ),
}));

import { CollaborativeNotesSection } from './CollaborativeNotesSection';

const ENTITY = '11111111-1111-4111-8111-111111111111';

function invitationIsVisible(): boolean {
  // happy-dom does not mark descendants of [hidden] as hidden, so the
  // accessibility query still sees the pad. A real browser does not.
  return screen
    .queryAllByText('Start writing collaborative notes…')
    .some((node) => node.closest('[hidden]') === null);
}

afterEach(() => {
  cleanup();
  phase.current = 'checking';
});

describe('CollaborativeNotesSection read', () => {
  it('does not invite writing while the note has not arrived', async () => {
    phase.current = 'checking';
    render(<CollaborativeNotesSection entityType="contact" entityId={ENTITY} />);

    expect(screen.getByRole('status').textContent).toBe(
      'Checking collaborative notes. They have not arrived.',
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(invitationIsVisible()).toBe(false);
  });

  it('does not invite writing when the note read fails', async () => {
    phase.current = 'failed';
    render(<CollaborativeNotesSection entityType="contact" entityId={ENTITY} />);

    expect(screen.getByRole('alert').textContent).toBe(
      'Could not load collaborative notes. The notes have not arrived.',
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(invitationIsVisible()).toBe(false);
  });

  it('invites writing only after a connected empty document arrives', async () => {
    phase.current = 'ready';
    render(<CollaborativeNotesSection entityType="contact" entityId={ENTITY} />);

    expect(await screen.findByTestId('collab-editor')).toBeTruthy();
    expect(screen.getByText('Start writing collaborative notes…')).toBeTruthy();
    expect(screen.queryByText('Checking collaborative notes. They have not arrived.')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
