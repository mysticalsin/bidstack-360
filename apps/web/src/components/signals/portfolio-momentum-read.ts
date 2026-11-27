// The list may look failed only after the read arrives.
// A pause has isLoading false and no payload. That read is still unread.
// Error wins, then undefined data is unread, else the read is ready.

export type PortfolioMomentumPhase = 'unread' | 'failed' | 'ready';

export interface PortfolioMomentumSnapshot {
  data?: unknown;
  isError?: boolean;
  status?: string;
}

export function portfolioMomentumPhase(snapshot: PortfolioMomentumSnapshot): PortfolioMomentumPhase {
  if (snapshot.isError === true || snapshot.status === 'error') return 'failed';
  if (snapshot.data === undefined) return 'unread';
  return 'ready';
}
