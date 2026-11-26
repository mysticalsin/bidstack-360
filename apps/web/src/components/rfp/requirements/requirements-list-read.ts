// Extracted requirements may say "No requirements yet" only after the payload
// arrives. A pause has isLoading false and no rows. That read is still unread.
// A failure with no payload is not an empty extract.

export type RequirementsListPhase = 'unread' | 'failed' | 'ready';

export interface RequirementsListRead {
  data?: unknown;
  isError?: boolean;
  status?: string;
}

export function requirementsListPhase(snapshot: RequirementsListRead): RequirementsListPhase {
  if (snapshot.data !== undefined) return 'ready';
  if (snapshot.isError === true || snapshot.status === 'error') return 'failed';
  return 'unread';
}
