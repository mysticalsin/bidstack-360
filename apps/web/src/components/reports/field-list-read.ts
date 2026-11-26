// The field catalog may look loaded only after the read arrives.
// A pause has isLoading false and no payload. That read is still unread.
// Error wins, then undefined data is unread, else the read is ready.

export type FieldListPhase = 'unread' | 'failed' | 'ready';

export interface FieldListSnapshot {
  data?: unknown;
  isError?: boolean;
  status?: string;
}

export function fieldListPhase(snapshot: FieldListSnapshot): FieldListPhase {
  if (snapshot.isError === true || snapshot.status === 'error') return 'failed';
  if (snapshot.data === undefined) return 'unread';
  return 'ready';
}
