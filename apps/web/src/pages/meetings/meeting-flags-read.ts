// A flag list may show an empty list only after the payload arrives.
// A pause or an idle read has isLoading false and no rows. That read is
// still unread. A failure with no payload is not an empty list.

export type MeetingFlagsReadPhase = 'unread' | 'failed' | 'ready';

export interface MeetingFlagsReadSnapshot {
  data?: unknown;
  isError?: boolean;
  status?: string;
}

export function meetingFlagsReadPhase(snapshot: MeetingFlagsReadSnapshot): MeetingFlagsReadPhase {
  if (snapshot.data !== undefined) return 'ready';
  if (snapshot.isError === true || snapshot.status === 'error') return 'failed';
  return 'unread';
}
