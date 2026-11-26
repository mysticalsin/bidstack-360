// The data mode banner may show a mode only after the identity read arrives.
// A pause has isLoading false and no payload. That read is still unread.
// Error wins, then undefined data is unread, else the read is ready.

export type DataModePhase = 'unread' | 'failed' | 'ready';

export interface DataModeSnapshot {
  data?: unknown;
  isError?: boolean;
  status?: string;
}

export function dataModePhase(snapshot: DataModeSnapshot): DataModePhase {
  if (snapshot.isError === true || snapshot.status === 'error') return 'failed';
  if (snapshot.data === undefined) return 'unread';
  return 'ready';
}
