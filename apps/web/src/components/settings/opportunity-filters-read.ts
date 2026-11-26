// The opportunity filter form may show only after the read arrives.
// A pause has isLoading false and no rules. That read is still unread.
// Error wins, then undefined data is unread, else the read is ready.

export type OpportunityFiltersPhase = 'unread' | 'failed' | 'ready';

export interface OpportunityFiltersSnapshot {
  data?: unknown;
  isError?: boolean;
  status?: string;
}

export function opportunityFiltersPhase(
  snapshot: OpportunityFiltersSnapshot,
): OpportunityFiltersPhase {
  if (snapshot.isError === true || snapshot.status === 'error') return 'failed';
  if (snapshot.data === undefined) return 'unread';
  return 'ready';
}
