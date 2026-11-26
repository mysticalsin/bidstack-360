// The consulting partner list may say it is empty only after the scan
// arrives. A pause has isLoading false and no rows. That read is still
// unread. A failure with no payload is not an empty list.

export type ConsultingPartnersReadPhase = 'unread' | 'failed' | 'ready';

export interface ConsultingPartnersReadSnapshot {
  data?: unknown;
  isError?: boolean;
  status?: string;
}

export function consultingPartnersReadPhase(
  snapshot: ConsultingPartnersReadSnapshot,
): ConsultingPartnersReadPhase {
  if (snapshot.data !== undefined) return 'ready';
  if (snapshot.isError === true || snapshot.status === 'error') return 'failed';
  return 'unread';
}
