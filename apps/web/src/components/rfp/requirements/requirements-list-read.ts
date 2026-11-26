// Extracted requirements may say "No requirements yet" only after the payload
// arrives. A pause has isLoading false and no rows. That read is still unread.
// A failure with no payload is not an empty extract.

export type RequirementsPhase = 'unread' | 'failed' | 'ready';

export interface RequirementsReadSnapshot {
  data?: unknown;
  isError?: boolean;
  status?: string;
}

export function requirementsPhase(snapshot: RequirementsReadSnapshot): RequirementsPhase {
  if (snapshot.data !== undefined) return 'ready';
  if (snapshot.isError === true || snapshot.status === 'error') return 'failed';
  return 'unread';
}
