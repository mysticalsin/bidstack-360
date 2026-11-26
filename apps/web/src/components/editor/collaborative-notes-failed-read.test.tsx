// A contact, lead, or opportunity opens the live notes pad before the Y.Doc
// arrives. An unread pad has no text. That is not an empty note: the screen
// must not invite the reader to start writing. A failed read has no text
// either. A document that has connected and is empty still invites writing.
// A document that arrived with text still shows that text.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const hookMocks = vi.hoisted(() => ({
  useYjsField: vi.fn(),
  noteBody: '',
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : key,
  }),
}));

vi.mock('framer-motion', () => ({
  useReducedMotion: () => true,
}));

vi.mock('@tiptap/starter-kit', () => ({
  default: { configure: () => ({ name: 'starter' }) },
}));

vi.mock('@tiptap/extension-collaboration', () => ({
  default: { configure: () => ({ name: 'collab' }) },
}));

vi.mock('@tiptap/extension-collaboration-cursor', () => ({
  default: { configure: () => ({ name: 'cursor' }) },
}));

vi.mock('@tiptap/react', () => ({
  useEditor: () => ({
    setEditable: () => undefined,
    getHTML: () => '',
    state: { selection: { from: 0, to: 0 } },
  }),
  EditorContent: () => (
    <div data-testid="collaborative-notes-editor">{hookMocks.noteBody}</div>
  ),
}));

vi.mock('@/hooks/useYjsField', () => ({
  useYjsField: hookMocks.useYjsField,
}));

import { CollaborativeRichTextEditor } from './CollaborativeRichTextEditor';

const START_WRITING = 'Start writing collaborative notes…';
const CHECKING = 'Checking collaborative notes.';
const FAILED = 'Could not load collaborative notes. The notes have not arrived.';

function noteDocument(value: string) {
  return {
    toString: () => value,
    length: value.length,
  };
}

function field(overrides: {
  connectionState: 'connecting' | 'connected' | 'disconnected' | 'error';
  text: string | null;
}) {
  const yText = overrides.text === null ? null : noteDocument(overrides.text);
  return {
    yText,
    ydoc: yText ? { guid: 'note-doc' } : null,
    connectionState: overrides.connectionState,
    remoteCursors: [],
    setCursor: () => undefined,
  };
}

function renderPad(overrides: {
  connectionState: 'connecting' | 'connected' | 'disconnected' | 'error';
  text: string | null;
}) {
  hookMocks.noteBody = overrides.text ?? '';
  hookMocks.useYjsField.mockReturnValue(field(overrides));
  return render(
    <CollaborativeRichTextEditor
      yjsOptions={{ entityType: 'contact', entityId: 'contact-1', fieldKey: 'notes' }}
      placeholder={START_WRITING}
      userName="Sample Reader"
      userId="reader-1"
    />,
  );
}

describe('Collaborative notes when the document has not arrived', () => {
  afterEach(() => {
    cleanup();
    hookMocks.noteBody = '';
    vi.clearAllMocks();
  });

  it('does not invite writing while the notes document is still unread', () => {
    // WHY: the pad paints before the Y.Doc exists. "Start writing" tells a
    // demo reader the note was checked and is empty.
    renderPad({ connectionState: 'connecting', text: null });

    expect(screen.getByText(CHECKING)).toBeTruthy();
    expect(screen.queryByText(START_WRITING)).toBeNull();
    expect(screen.queryByTestId('collaborative-notes-editor')).toBeNull();
  });

  it('does not show a blank pad while an empty document is still connecting', () => {
    // WHY: once the local Y.Doc exists it is still empty until init arrives.
    // A blank editor reads as no notes.
    renderPad({ connectionState: 'connecting', text: '' });

    expect(screen.getByText(CHECKING)).toBeTruthy();
    expect(screen.queryByText(START_WRITING)).toBeNull();
    expect(screen.queryByTestId('collaborative-notes-editor')).toBeNull();
  });

  it('does not invite writing when the notes document failed to load', () => {
    // WHY: a failed read has no text. The empty invitation would say the
    // note arrived and there is nothing in it.
    renderPad({ connectionState: 'error', text: null });

    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(START_WRITING)).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByTestId('collaborative-notes-editor')).toBeNull();
  });

  it('still invites writing when a connected document is empty', () => {
    // WHY: a document that arrived with no text is empty. The invitation stays.
    renderPad({ connectionState: 'connected', text: '' });

    expect(screen.getByText(START_WRITING)).toBeTruthy();
    expect(screen.getByTestId('collaborative-notes-editor')).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
  });

  it('still shows a note that has arrived', () => {
    // WHY: a document that arrived with text keeps that text. The empty
    // invitation is only for a settled empty document.
    renderPad({ connectionState: 'connected', text: 'Kickoff note' });

    expect(screen.getByText('Kickoff note')).toBeTruthy();
    expect(screen.queryByText(START_WRITING)).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
  });
});
