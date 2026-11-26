// The workspace list may look empty only after the read arrives.
// A pause has isLoading false and no payload. That read is still unread.
// Error wins, then undefined data is unread, else the read is ready.

export type WorkspaceAccountsPhase = 'unread' | 'failed' | 'ready';

export interface WorkspaceAccountsSnapshot {
  data?: unknown;
  isError?: boolean;
  status?: string;
}

export function workspaceAccountsPhase(snapshot: WorkspaceAccountsSnapshot): WorkspaceAccountsPhase {
  if (snapshot.isError === true || snapshot.status === 'error') return 'failed';
  if (snapshot.data === undefined) return 'unread';
  return 'ready';
}
