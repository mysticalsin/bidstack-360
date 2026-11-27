// The conversation list may show only after the read arrives.
// A pause has isLoading false and no list. That read is still unread.
// Error wins, then undefined data is unread, else the read is ready.

export type AccountConversationsPhase = 'unread' | 'failed' | 'ready';

export interface AccountConversationsSnapshot {
  data?: unknown;
  isError?: boolean;
  status?: string;
}

export function accountConversationsPhase(
  snapshot: AccountConversationsSnapshot,
): AccountConversationsPhase {
  if (snapshot.isError === true || snapshot.status === 'error') return 'failed';
  if (snapshot.data === undefined) return 'unread';
  return 'ready';
}
