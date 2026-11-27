// The competitor catalog may say "No competitors yet" only after the
// payload arrives. A pause has isLoading false and no rows. That read
// is still unread. A failure with no payload is not an empty catalog.

export type CompetitorProfilesPhase = 'unread' | 'failed' | 'ready';

export interface CompetitorProfilesRead {
  data?: unknown;
  isError?: boolean;
  status?: string;
}

export function competitorProfilesPhase(snapshot: CompetitorProfilesRead): CompetitorProfilesPhase {
  if (snapshot.data !== undefined) return 'ready';
  if (snapshot.isError === true || snapshot.status === 'error') return 'failed';
  return 'unread';
}
