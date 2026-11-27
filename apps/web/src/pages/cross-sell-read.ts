// The org cross-sell log may say the book is empty, or count 0, only after
// the list arrives. A pause has isLoading false and no rows. That read is
// still unread. A failure with no payload is not an empty log.

export type CrossSellReadPhase = 'unread' | 'failed' | 'ready';

export interface CrossSellReadSnapshot {
  data?: unknown;
  isError?: boolean;
  status?: string;
}

export function crossSellReadPhase(snapshot: CrossSellReadSnapshot): CrossSellReadPhase {
  if (snapshot.data !== undefined) return 'ready';
  if (snapshot.isError === true || snapshot.status === 'error') return 'failed';
  return 'unread';
}
