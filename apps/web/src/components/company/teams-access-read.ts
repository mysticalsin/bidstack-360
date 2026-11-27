// The import sheet may open chats only after the access read arrives.
// A pause has isLoading false and no status. That read is still unread.
// Error wins, then undefined data is unread, else the read is ready.

export type TeamsAccessPhase = 'unread' | 'failed' | 'ready';

export interface TeamsAccessSnapshot {
  data?: unknown;
  isError?: boolean;
  status?: string;
}

export function teamsAccessPhase(snapshot: TeamsAccessSnapshot): TeamsAccessPhase {
  if (snapshot.isError === true || snapshot.status === 'error') return 'failed';
  if (snapshot.data === undefined) return 'unread';
  return 'ready';
}
