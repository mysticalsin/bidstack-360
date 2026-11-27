// The data region form may show only after the read arrives.
// A pause has isLoading false and no setting. That read is still unread.
// Error wins, then undefined data is unread, else the read is ready.

export type DataResidencyPhase = 'unread' | 'failed' | 'ready';

export interface DataResidencySnapshot {
  data?: unknown;
  isError?: boolean;
  status?: string;
}

export function dataResidencyPhase(snapshot: DataResidencySnapshot): DataResidencyPhase {
  if (snapshot.isError === true || snapshot.status === 'error') return 'failed';
  if (snapshot.data === undefined) return 'unread';
  return 'ready';
}
