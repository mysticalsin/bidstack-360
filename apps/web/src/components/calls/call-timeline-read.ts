// A call timeline may show a failed load only when the read fails with no
// payload. A pause has isLoading false and no call. That read is still unread.
// A payload that already arrived stays when a later read fails.

export type CallTimelinePhase = 'unread' | 'failed' | 'ready';

export interface CallTimelineReadSnapshot {
  data?: unknown;
  isError?: boolean;
  status?: string;
}

export function callTimelinePhase(snapshot: CallTimelineReadSnapshot): CallTimelinePhase {
  if (snapshot.data !== undefined) return 'ready';
  if (snapshot.isError === true || snapshot.status === 'error') return 'failed';
  return 'unread';
}
