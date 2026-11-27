// A relation list may show an empty list only after the payload arrives.
// A pause has isLoading false and no rows. That read is still unread.
// A failure with no payload is not a missing list.

export type RelationsListPhase = 'unread' | 'failed' | 'ready';

export interface RelationsListReadSnapshot {
  data?: unknown;
  isError?: boolean;
  status?: string;
}

export function relationsListPhase(snapshot: RelationsListReadSnapshot): RelationsListPhase {
  if (snapshot.data !== undefined) return 'ready';
  if (snapshot.isError === true || snapshot.status === 'error') return 'failed';
  return 'unread';
}
