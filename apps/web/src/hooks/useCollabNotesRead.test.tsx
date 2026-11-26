// WHY: the notes section only learns that a pad is unread, rejected, or
// delivered through this subscription. A missing snapshot is not an empty note.
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  closeCollabDoc,
  collabDocKey,
  publishCollabDoc,
} from '@/lib/collab-notes-read';
import { useCollabNotesRead } from './useCollabNotesRead';

const ENTITY = '22222222-2222-4222-8222-222222222222';
const KEY = collabDocKey('lead', ENTITY, 'notes');

function Probe() {
  const phase = useCollabNotesRead('lead', ENTITY, 'notes');
  return <p>{phase}</p>;
}

afterEach(() => {
  closeCollabDoc(KEY);
  cleanup();
});

describe('useCollabNotesRead', () => {
  it('stays on checking until a document is delivered, then follows a rejection', () => {
    render(<Probe />);
    expect(screen.getByText('checking')).toBeTruthy();

    act(() => {
      publishCollabDoc(KEY, { connection: 'connecting', textLength: 0 });
    });
    expect(screen.getByText('checking')).toBeTruthy();

    act(() => {
      publishCollabDoc(KEY, { connection: 'connected', textLength: 0 });
    });
    expect(screen.getByText('ready')).toBeTruthy();

    act(() => {
      publishCollabDoc(KEY, { connection: 'error', textLength: 0 });
    });
    expect(screen.getByText('failed')).toBeTruthy();
  });
});
