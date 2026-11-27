// The public signing page may say the link is invalid only after the
// server says so. A pause has isLoading false and no payload. That read
// is still unread. A failure with no payload is not an invalid link.

import { ApiError } from '@/lib/api';

export type PublicSignPhase = 'unread' | 'failed' | 'settled' | 'ready';

export interface PublicSignSnapshot {
  data?: unknown;
  error?: unknown;
}

const SETTLED_LINK_STATUS = new Set([400, 404, 410]);

export function publicSignPhase(snapshot: PublicSignSnapshot): PublicSignPhase {
  if (snapshot.data !== undefined) return 'ready';
  if (snapshot.error == null) return 'unread';
  if (snapshot.error instanceof ApiError && SETTLED_LINK_STATUS.has(snapshot.error.status)) {
    return 'settled';
  }
  return 'failed';
}
