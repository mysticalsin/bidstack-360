// A flags list may say "No open flags" or "Nothing dismissed" only after the
// payload arrives. A pause has isLoading false and no rows. That read is
// still unread. A failure is not an empty book. The tab uses the same phase
// so a missing payload is not the zero-flag label.

export type MeetingFlagsPhase = 'unread' | 'failed' | 'ready';

export interface MeetingFlagsSnapshot {
  data?: unknown;
  isError?: boolean;
  status?: 'pending' | 'error' | 'success';
}

export function meetingFlagsPhase(snapshot: MeetingFlagsSnapshot): MeetingFlagsPhase {
  if (snapshot.isError === true || snapshot.status === 'error') return 'failed';
  if (snapshot.data === undefined) return 'unread';
  return 'ready';
}
