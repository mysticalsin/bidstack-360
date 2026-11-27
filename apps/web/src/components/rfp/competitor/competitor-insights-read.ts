// Cited competitor findings may say "No competitor findings yet" only after
// the payload arrives. A pause has isLoading false and no rows. That read
// is still unread. A failure with no payload is not an empty research pass.

export type CompetitorInsightsPhase = 'unread' | 'failed' | 'ready';

export interface CompetitorInsightsRead {
  data?: unknown;
  isError?: boolean;
  status?: string;
}

export function competitorInsightsPhase(snapshot: CompetitorInsightsRead): CompetitorInsightsPhase {
  if (snapshot.data !== undefined) return 'ready';
  if (snapshot.isError === true || snapshot.status === 'error') return 'failed';
  return 'unread';
}
