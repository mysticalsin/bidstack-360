// The object may look missing only after the catalog arrives.
// A pause has isLoading false and no payload. That read is still unread.
// Error wins, then undefined data is unread, else the read is ready.

export type CustomObjectEditorPhase = 'unread' | 'failed' | 'ready';

export interface CustomObjectEditorSnapshot {
  data?: unknown;
  isError?: boolean;
  status?: string;
}

export function customObjectEditorPhase(
  snapshot: CustomObjectEditorSnapshot,
): CustomObjectEditorPhase {
  if (snapshot.isError === true || snapshot.status === 'error') return 'failed';
  if (snapshot.data === undefined) return 'unread';
  return 'ready';
}
