// A meetings list may say "No meetings yet" only after the payload arrives.
// A pause has isLoading false and no rows. That read is still unread.
// A failure is not an empty book.

export type MeetingsListPhase = 'unread' | 'failed' | 'ready';

export interface MeetingsListSnapshot {
  data?: unknown;
  isError?: boolean;
  status?: 'pending' | 'error' | 'success';
}

export function meetingsListPhase(snapshot: MeetingsListSnapshot): MeetingsListPhase {
  if (snapshot.isError === true || snapshot.status === 'error') return 'failed';
  if (snapshot.data === undefined) return 'unread';
  return 'ready';
}
