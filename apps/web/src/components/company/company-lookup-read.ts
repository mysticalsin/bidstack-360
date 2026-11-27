// The company lookup may say Ready to enrich only after the read arrives.
// A pause has isLoading false and no profile. That read is still unread.
// Error wins, then undefined data is unread, else the read is ready.

export type CompanyLookupPhase = 'unread' | 'failed' | 'ready';

export interface CompanyLookupSnapshot {
  data?: unknown;
  isError?: boolean;
  status?: string;
}

export function companyLookupPhase(snapshot: CompanyLookupSnapshot): CompanyLookupPhase {
  if (snapshot.isError === true || snapshot.status === 'error') return 'failed';
  if (snapshot.data === undefined) return 'unread';
  return 'ready';
}
