// Document search may say it found no file text only after the hits arrive.
// A pause has isLoading false and no hits. That read is still unread.
// A failure with no payload is not an empty search.

export type DocumentHitsReadPhase = 'unread' | 'failed' | 'ready';

export interface DocumentHitsReadSnapshot {
  data?: unknown;
  isError?: boolean;
  status?: string;
}

export function documentHitsReadPhase(
  snapshot: DocumentHitsReadSnapshot,
): DocumentHitsReadPhase {
  if (snapshot.data !== undefined) return 'ready';
  if (snapshot.isError === true || snapshot.status === 'error') return 'failed';
  return 'unread';
}
