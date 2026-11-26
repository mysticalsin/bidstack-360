// The tag list may say it is empty only after the read arrives.
// A pause has isLoading false and no payload. That read is still unread.
// Error wins, then undefined data is unread, else the read is ready.

export type TagListPhase = 'unread' | 'failed' | 'ready';

export interface TagListSnapshot {
  data?: unknown;
  isError?: boolean;
  status?: string;
}

export function tagListPhase(snapshot: TagListSnapshot): TagListPhase {
  if (snapshot.isError === true || snapshot.status === 'error') return 'failed';
  if (snapshot.data === undefined) return 'unread';
  return 'ready';
}
