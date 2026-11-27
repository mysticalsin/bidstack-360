export type IntakeFilesPhase = 'unread' | 'failed' | 'ready';

// Error wins. A payload that has not arrived is unread, including null only
// after the read settles. Undefined data is the read that has not arrived.
export function intakeFilesPhase(snapshot: {
  data?: unknown;
  isError?: boolean;
  status?: string;
}): IntakeFilesPhase {
  if (snapshot.isError === true || snapshot.status === 'error') return 'failed';
  if (snapshot.data === undefined) return 'unread';
  return 'ready';
}
