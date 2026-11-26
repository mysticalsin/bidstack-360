export type NotesListRead = 'unread' | 'failed' | 'empty' | 'ready';

/**
 * The notes list and each note row are one read.
 * A count of zero is an empty account only after a payload arrives.
 * A pending or failed read has no rows yet, even when a caller passes 0.
 */
export function notesListRead(input: {
  isPending: boolean;
  isError: boolean;
  count: number | null;
}): NotesListRead {
  if (input.isError) return 'failed';
  if (input.isPending || input.count === null) return 'unread';
  if (input.count === 0) return 'empty';
  return 'ready';
}

export function notesListReadMessage(phase: 'unread' | 'failed'): string {
  if (phase === 'unread') return 'Checking notes. They have not arrived.';
  return 'Could not load notes. The notes have not arrived.';
}
