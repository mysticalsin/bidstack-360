// A reports list may say "No reports found" or count 0 only after the
// payload arrives. A pause has isLoading false and no rows. That read is
// still unread. A failure is not an empty catalog.

export type ReportsListPhase = 'unread' | 'failed' | 'ready';

export interface ReportsListSnapshot {
  data?: unknown;
  isError?: boolean;
  status?: 'pending' | 'error' | 'success';
}

export function reportsListPhase(snapshot: ReportsListSnapshot): ReportsListPhase {
  if (snapshot.isError === true || snapshot.status === 'error') return 'failed';
  if (snapshot.data === undefined) return 'unread';
  return 'ready';
}
