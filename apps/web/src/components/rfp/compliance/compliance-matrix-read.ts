// A compliance matrix may say "No compliance data yet" only after the payload
// arrives. A pause has isLoading false and no rows. That read is still unread.
// A failure with no payload is not an empty matrix.

export type CompliancePhase = 'unread' | 'failed' | 'ready';

export interface ComplianceReadSnapshot {
  data?: unknown;
  isError?: boolean;
  status?: string;
}

export function compliancePhase(snapshot: ComplianceReadSnapshot): CompliancePhase {
  if (snapshot.data !== undefined) return 'ready';
  if (snapshot.isError === true || snapshot.status === 'error') return 'failed';
  return 'unread';
}
