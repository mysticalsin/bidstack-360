// Recent imports may be named only after the list read arrives.
// A pause has isLoading false and no list. That read is still unread.
// Error wins, then undefined data is unread, else the read is ready.

export type ImportHistoryPhase = 'unread' | 'failed' | 'ready';

export interface ImportHistorySnapshot {
  data?: unknown;
  isError?: boolean;
  status?: string;
}

export function importHistoryPhase(snapshot: ImportHistorySnapshot): ImportHistoryPhase {
  if (snapshot.isError === true || snapshot.status === 'error') return 'failed';
  if (snapshot.data === undefined) return 'unread';
  return 'ready';
}
