// A stored toolkit list may say "No stored toolkits yet" only after the
// payload arrives. A pause has isLoading false and no rows. That read is
// still unread. A failure with no payload is not an empty library.

export type ToolkitStorePhase = 'unread' | 'failed' | 'ready';

export interface ToolkitStoreReadSnapshot {
  data?: unknown;
  isError?: boolean;
  status?: string;
}

export function toolkitStorePhase(snapshot: ToolkitStoreReadSnapshot): ToolkitStorePhase {
  if (snapshot.data !== undefined) return 'ready';
  if (snapshot.isError === true || snapshot.status === 'error') return 'failed';
  return 'unread';
}
