import { describe, expect, it } from 'vitest';

import { notesListRead, notesListReadMessage } from './notes-list-read';

const SETTLED_EMPTY = /\b(empty|none|available)\b/i;

describe('notesListRead', () => {
  it('does not treat a missing notes payload as an empty list', () => {
    // WHY: a paused read often arrives as count 0. That is not an account with no notes.
    expect(notesListRead({ isPending: true, isError: false, count: 0 })).toBe('unread');
    expect(notesListRead({ isPending: true, isError: false, count: null })).toBe('unread');
    expect(notesListReadMessage('unread')).toBe('Checking notes. They have not arrived.');
    expect(notesListReadMessage('unread')).not.toMatch(SETTLED_EMPTY);
  });

  it('does not treat a failed notes read as empty or unknown', () => {
    // WHY: a failed read has not delivered the list or a note detail.
    expect(notesListRead({ isPending: false, isError: true, count: 0 })).toBe('failed');
    expect(notesListRead({ isPending: true, isError: true, count: null })).toBe('failed');
    expect(notesListReadMessage('failed')).toBe(
      'Could not load notes. The notes have not arrived.',
    );
    expect(notesListReadMessage('failed')).not.toMatch(SETTLED_EMPTY);
    expect(notesListReadMessage('failed')).not.toMatch(/unknown/i);
  });

  it('keeps an arrived empty notes list empty', () => {
    // WHY: zero is honest only after the payload landed and held no notes.
    expect(notesListRead({ isPending: false, isError: false, count: 0 })).toBe('empty');
  });

  it('keeps a note that has arrived', () => {
    // WHY: a row that arrived is the note detail. The unread sentence must not replace it.
    expect(notesListRead({ isPending: false, isError: false, count: 1 })).toBe('ready');
  });
});
