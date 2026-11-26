// The account picker may list companies only after the read arrives.
// A pause has isLoading false and no list. That read is still unread.
// Error wins, then undefined data is unread, else the read is ready.

export type IntakeAccountPhase = 'unread' | 'failed' | 'ready';

export interface IntakeAccountSnapshot {
  data?: unknown;
  isError?: boolean;
  status?: string;
}

export function intakeAccountPhase(snapshot: IntakeAccountSnapshot): IntakeAccountPhase {
  if (snapshot.isError === true || snapshot.status === 'error') return 'failed';
  if (snapshot.data === undefined) return 'unread';
  return 'ready';
}
