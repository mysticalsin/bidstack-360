// The sync control may name a last sync only after the overview read arrives.
// A pause has isLoading false and no overview. That read is still unread.
// Error wins, then undefined data is unread, else the read is ready.

export type SyncStatusPhase = 'unread' | 'failed' | 'ready';

export interface SyncStatusSnapshot {
  data?: unknown;
  isError?: boolean;
  status?: string;
}

export function syncStatusPhase(snapshot: SyncStatusSnapshot): SyncStatusPhase {
  if (snapshot.isError === true || snapshot.status === 'error') return 'failed';
  if (snapshot.data === undefined) return 'unread';
  return 'ready';
}
