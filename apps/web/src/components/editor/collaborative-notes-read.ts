// The collaborative pad may say it is empty only after the document connects.
// An idle read has no entity, so the hook never opens a document. A paused
// read is disconnected and has no text. An in-flight read can already hold a
// local empty Y.Text. Those three have not arrived. A failure with no text is
// not an empty note. Text that has already arrived stays, including when the
// socket later errors.

export type CollaborativeNotesPhase = 'unread' | 'failed' | 'empty' | 'ready';

export type CollaborativeNotesConnection = 'connecting' | 'connected' | 'disconnected' | 'error';

export interface CollaborativeNotesReadSnapshot {
  /** null while no Y.Text exists. A string, including '', is the document text. */
  text: string | null;
  connectionState: CollaborativeNotesConnection;
}

export function collaborativeNotesPhase(
  snapshot: CollaborativeNotesReadSnapshot,
): CollaborativeNotesPhase {
  if (snapshot.text !== null && snapshot.text.trim().length > 0) return 'ready';
  if (snapshot.connectionState === 'connected' && snapshot.text !== null) return 'empty';
  if (snapshot.connectionState === 'error') return 'failed';
  return 'unread';
}
