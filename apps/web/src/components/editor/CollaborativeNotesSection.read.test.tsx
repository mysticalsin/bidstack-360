// The live notes section mounts before the collaborative document arrives.
// An idle read has no entity yet. A paused read is disconnected with no text.
// An in-flight read can already hold a local empty Y.Text. None of those is a
// settled empty note. "Start writing" and a blank pad are for a document that
// connected and was empty. A failed read keeps the error and a retry. A note
// that arrived stays.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'error';

const hookMocks = vi.hoisted(() => ({
  noteText: null as string | null,
  connectionState: 'disconnected' as ConnectionState,
  useYjsField: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : key,
  }),
}));

vi.mock('@/lib/auth', () => ({
  useUser: () => ({ user: { id: 'reader-1', fullName: 'Sample Reader' } }),
}));

vi.mock('@/hooks/useYjsField', () => ({
  useYjsField: hookMocks.useYjsField,
}));

vi.mock('./CollaborativeRichTextEditor', () => ({
  CollaborativeRichTextEditor: (props: { placeholder?: string }) => {
    // Mirrors the pad on main: the invitation is painted only while there is
    // no Y.Text. A local empty document paints a blank editor instead.
    const showInvitation = hookMocks.noteText === null && Boolean(props.placeholder);
    return (
      <div data-testid="collaborative-notes-editor" data-connection={hookMocks.connectionState}>
        {showInvitation ? props.placeholder : null}
        {hookMocks.noteText ? hookMocks.noteText : null}
      </div>
    );
  },
}));

import { CollaborativeNotesSection } from './CollaborativeNotesSection';

const START_WRITING = 'Start writing collaborative notes…';
const CHECKING = 'Checking collaborative notes. They have not arrived.';
const FAILED = "Couldn't load collaborative notes";
const FAILED_MESSAGE = 'The notes did not load.';
const LOADED = 'Kickoff note';
const ENTITY_ID = '11111111-1111-4111-8111-111111111111';

function setRead(connectionState: ConnectionState, text: string | null) {
  hookMocks.noteText = text;
  hookMocks.connectionState = connectionState;
  hookMocks.useYjsField.mockReturnValue({
    yText: text === null ? null : { toString: () => text },
    ydoc: text === null ? null : { guid: 'note-doc' },
    connectionState,
    remoteCursors: [],
    setCursor: () => undefined,
  });
}

function renderSection(entityId: string | undefined = ENTITY_ID) {
  return render(
    <CollaborativeNotesSection entityType="lead" entityId={entityId} fieldKey="notes" />,
  );
}

async function settlePaint() {
  await waitFor(() => {
    const arrived =
      screen.queryByText(CHECKING) ??
      screen.queryByText(START_WRITING) ??
      screen.queryByTestId('collaborative-notes-editor') ??
      screen.queryByRole('alert');
    expect(arrived).toBeTruthy();
  });
}

describe('Collaborative notes section before the document arrives', () => {
  afterEach(() => {
    cleanup();
    hookMocks.noteText = null;
    hookMocks.connectionState = 'disconnected';
    hookMocks.useYjsField.mockReset();
  });

  it('does not call an idle unread pad an empty note', async () => {
    // WHY: the section can paint before an entity id exists. There is no
    // document. "Start writing" says the note was read and is empty.
    setRead('disconnected', null);
    renderSection(undefined);
    await settlePaint();

    expect(screen.queryByText(START_WRITING)).toBeNull();
    expect(screen.getByRole('status').textContent).toContain(CHECKING);
    expect(screen.queryByTestId('collaborative-notes-editor')).toBeNull();
    expect(screen.queryByText(/no notes/i)).toBeNull();
    expect(screen.queryByText(/missing/i)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('does not call a paused read an empty note', async () => {
    // WHY: a paused read is disconnected and has no text. isLoading is not
    // the signal. The blank invitation is a document that already arrived.
    setRead('disconnected', null);
    renderSection();
    await settlePaint();

    expect(screen.queryByText(START_WRITING)).toBeNull();
    expect(screen.getByRole('status').textContent).toContain(CHECKING);
    expect(screen.queryByTestId('collaborative-notes-editor')).toBeNull();
    expect(screen.queryByText(/no notes/i)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('does not call an in-flight empty document a settled empty note', async () => {
    // WHY: the local Y.Text exists and is empty while the sync is still in
    // flight. A blank pad reads as no notes. The document has not arrived.
    setRead('connecting', '');
    renderSection();
    await settlePaint();

    expect(screen.queryByText(START_WRITING)).toBeNull();
    expect(screen.getByRole('status').textContent).toContain(CHECKING);
    expect(screen.queryByTestId('collaborative-notes-editor')).toBeNull();
    expect(screen.queryByText(/no notes/i)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('keeps a failed read on the error and retry', async () => {
    // WHY: a failed read has no text. The empty invitation would say the
    // note arrived empty. Retry asks for the document again.
    setRead('error', null);
    renderSection();
    await settlePaint();

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.getByText(FAILED_MESSAGE)).toBeTruthy();
    expect(screen.queryByText(START_WRITING)).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByTestId('collaborative-notes-editor')).toBeNull();
    expect(screen.queryByText(LOADED)).toBeNull();

    const beforeRetry = hookMocks.useYjsField.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(hookMocks.useYjsField.mock.calls.length).toBeGreaterThan(beforeRetry);
  });

  it('keeps a settled empty document on the pad', async () => {
    // WHY: a document that connected with no text is empty. The pad stays.
    // That is not the checking line, and it is not a failed read.
    setRead('connected', '');
    renderSection();
    await settlePaint();

    expect(screen.getByTestId('collaborative-notes-editor')).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(LOADED)).toBeNull();
  });

  it('keeps a note that has arrived', async () => {
    // WHY: a document that arrived with text keeps that text. The checking
    // line and the empty invitation must not replace it.
    setRead('connected', LOADED);
    renderSection();
    await settlePaint();

    expect(screen.getByText(LOADED)).toBeTruthy();
    expect(screen.getByTestId('collaborative-notes-editor')).toBeTruthy();
    expect(screen.queryByText(START_WRITING)).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('keeps a loaded note when a later read fails', async () => {
    // WHY: text already on the document is the note. A socket error after
    // that text arrived is not an empty pad and not a missing note.
    setRead('error', LOADED);
    renderSection();
    await settlePaint();

    expect(screen.getByText(LOADED)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(START_WRITING)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
  });
});
