// The public booking page may say the link is invalid only after the
// server says the page is missing. A read still in flight has no schedule.
// A failure with no page is not an invalid link, and it is not an empty day.

export type PublicBookingPhase = 'unread' | 'failed' | 'missing' | 'ready';

export interface PublicBookingSnapshot {
  loading: boolean;
  availability: unknown;
  failed: boolean;
  httpStatus: number | null;
}

export function publicBookingPhase(snapshot: PublicBookingSnapshot): PublicBookingPhase {
  if (snapshot.loading) return 'unread';
  if (!snapshot.failed) {
    return snapshot.availability == null ? 'unread' : 'ready';
  }
  if (snapshot.httpStatus === 404) return 'missing';
  return 'failed';
}
