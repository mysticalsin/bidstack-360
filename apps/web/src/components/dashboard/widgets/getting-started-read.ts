// The first-run screen may say the workspace is empty only after the summary
// arrives. A pause has isLoading false and no counts. That read is still unread.
// Error wins, then undefined data is unread, else the read is ready.

export type GettingStartedPhase = 'unread' | 'failed' | 'ready';

export interface GettingStartedSnapshot {
  data?: unknown;
  isError?: boolean;
  status?: string;
}

export function gettingStartedPhase(snapshot: GettingStartedSnapshot): GettingStartedPhase {
  if (snapshot.isError === true || snapshot.status === 'error') return 'failed';
  if (snapshot.data === undefined) return 'unread';
  return 'ready';
}
