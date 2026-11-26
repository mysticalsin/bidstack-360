// WHY: an unread or rejected collaborative note used to look like a blank
// pad the reader could treat as empty. Empty is only a document the server
// has already delivered with no text, or text that is already local.
import { describe, expect, it } from 'vitest';

import {
  collabNotesRead,
  collabServerMessageFailed,
  collabSocketClosed,
} from './collab-notes-read';

describe('collabNotesRead', () => {
  it('keeps an unread pad on checking instead of calling it empty', () => {
    expect(collabNotesRead({ connection: 'absent', textLength: 0 })).toBe('checking');
    expect(collabNotesRead({ connection: 'connecting', textLength: 0 })).toBe('checking');
    expect(collabNotesRead({ connection: 'disconnected', textLength: 0 })).toBe('checking');
  });

  it('keeps a server rejection off the empty pad', () => {
    expect(collabNotesRead({ connection: 'error', textLength: 0 })).toBe('failed');
    expect(collabServerMessageFailed('error')).toBe(true);
    expect(collabServerMessageFailed('yjs:init-reply')).toBe(false);
  });

  it('does not reconnect a rejected read, and does reconnect a drop', () => {
    expect(collabSocketClosed(true)).toEqual({ connection: 'error', reconnect: false });
    expect(collabSocketClosed(false)).toEqual({ connection: 'disconnected', reconnect: true });
  });

  it('treats a delivered empty document as ready, and keeps local text ready', () => {
    expect(collabNotesRead({ connection: 'connected', textLength: 0 })).toBe('ready');
    expect(collabNotesRead({ connection: 'disconnected', textLength: 12 })).toBe('ready');
    expect(collabNotesRead({ connection: 'error', textLength: 4 })).toBe('ready');
  });
});
