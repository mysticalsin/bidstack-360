export type ExtractStatusPhase = 'unread' | 'failed' | 'ready';

// Error wins. A payload that has not arrived is unread, including a pause.
// A settled null payload is an empty list, so it is ready. Undefined data
// is the read that has not arrived.
export function extractStatusPhase(snapshot: {
  data?: unknown;
  isError?: boolean;
  status?: string;
}): ExtractStatusPhase {
  if (snapshot.isError === true || snapshot.status === 'error') return 'failed';
  if (snapshot.data === undefined) return 'unread';
  return 'ready';
}
