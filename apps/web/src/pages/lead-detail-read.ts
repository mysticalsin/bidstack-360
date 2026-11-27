// The lead record may say it is missing only after the read arrives. A pause
// has isLoading false and no payload. That read is still unread. A failure
// with no payload is not a deleted lead. A 404 is the server closing the
// record as missing.

import { ApiError } from '@/lib/api';

export type LeadDetailReadPhase = 'unread' | 'failed' | 'missing' | 'ready';

export interface LeadDetailReadSnapshot {
  data?: unknown;
  isError?: boolean;
  status?: string;
  error?: unknown;
}

export function leadDetailReadPhase(snapshot: LeadDetailReadSnapshot): LeadDetailReadPhase {
  if (snapshot.data !== undefined) return 'ready';
  if (snapshot.error instanceof ApiError && snapshot.error.status === 404) return 'missing';
  if (snapshot.isError === true || snapshot.status === 'error') return 'failed';
  return 'unread';
}
