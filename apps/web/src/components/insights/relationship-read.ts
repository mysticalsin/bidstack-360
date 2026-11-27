// The relationships diagram may show companies or people only after the read arrives.
// A pause has isLoading false and no payload. That read is still unread.
// Error wins, then undefined data is unread, else the read is ready.

export type RelationshipPhase = 'unread' | 'failed' | 'ready';

export interface RelationshipSnapshot {
  data?: unknown;
  isError?: boolean;
  status?: string;
}

export function relationshipPhase(snapshot: RelationshipSnapshot): RelationshipPhase {
  if (snapshot.isError === true || snapshot.status === 'error') return 'failed';
  if (snapshot.data === undefined) return 'unread';
  return 'ready';
}
