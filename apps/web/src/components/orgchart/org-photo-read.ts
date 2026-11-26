// An API photo may paint only after the blob read arrives.
// A pause has isLoading false and no blob. That read is still unread.
// Error wins, then undefined data is unread, else the read is ready.

export type OrgPhotoPhase = 'unread' | 'failed' | 'ready';

export interface OrgPhotoSnapshot {
  data?: unknown;
  isError?: boolean;
  status?: string;
}

export function orgPhotoPhase(snapshot: OrgPhotoSnapshot): OrgPhotoPhase {
  if (snapshot.isError === true || snapshot.status === 'error') return 'failed';
  if (snapshot.data === undefined) return 'unread';
  return 'ready';
}
