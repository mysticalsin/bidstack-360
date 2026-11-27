// The service desk may list cases only after the read arrives.
// A pause has isLoading false and no list. That read is still unread.
// Error wins, then undefined data is unread, else the read is ready.

export type ServiceDeskListPhase = 'unread' | 'failed' | 'ready';

export interface ServiceDeskListSnapshot {
  data?: unknown;
  isError?: boolean;
  status?: string;
}

export function serviceDeskListPhase(snapshot: ServiceDeskListSnapshot): ServiceDeskListPhase {
  if (snapshot.isError === true || snapshot.status === 'error') return 'failed';
  if (snapshot.data === undefined) return 'unread';
  return 'ready';
}
