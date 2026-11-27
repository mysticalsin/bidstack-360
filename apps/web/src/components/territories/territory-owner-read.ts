// The owner list may look empty only after the read arrives.
// A pause has isLoading false and no payload. That read is still unread.
// Error wins, then undefined data is unread, else the read is ready.

export type TerritoryOwnerPhase = 'unread' | 'failed' | 'ready';

export interface TerritoryOwnerSnapshot {
  data?: unknown;
  isError?: boolean;
  status?: string;
}

export function territoryOwnerPhase(snapshot: TerritoryOwnerSnapshot): TerritoryOwnerPhase {
  if (snapshot.isError === true || snapshot.status === 'error') return 'failed';
  if (snapshot.data === undefined) return 'unread';
  return 'ready';
}
