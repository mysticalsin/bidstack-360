// A desk may say "No live bids on this desk right now." only after the
// payload arrives. A pause has isLoading false and no rows. That read is
// still unread. A failure with no payload is not an empty desk.

export type OwnerDrilldownPhase = 'unread' | 'failed' | 'ready';

export interface OwnerDrilldownRead {
  data?: unknown;
  isError?: boolean;
  status?: string;
}

export function ownerDrilldownPhase(snapshot: OwnerDrilldownRead): OwnerDrilldownPhase {
  if (snapshot.data !== undefined) return 'ready';
  if (snapshot.isError === true || snapshot.status === 'error') return 'failed';
  return 'unread';
}
