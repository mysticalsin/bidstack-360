// The technology stack wall may show technologies only after the read arrives.
// A pause has isLoading false and no payload. That read is still unread.
// Error wins, then undefined data is unread, else the read is ready.

export type TechStackPhase = 'unread' | 'failed' | 'ready';

export interface TechStackSnapshot {
  data?: unknown;
  isError?: boolean;
  status?: string;
}

export function techStackPhase(snapshot: TechStackSnapshot): TechStackPhase {
  if (snapshot.isError === true || snapshot.status === 'error') return 'failed';
  if (snapshot.data === undefined) return 'unread';
  return 'ready';
}
