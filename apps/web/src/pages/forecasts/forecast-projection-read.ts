// The weighted pipeline projection may say "No open pipeline" only after
// the read settles without an open or won value. A pause and an in-flight
// fetch have no payload yet. A failed read is not an empty book.

export type ForecastProjectionPhase = 'unread' | 'failed' | 'empty' | 'ready';

export interface ForecastProjectionReadSnapshot {
  data?: { periods?: Array<{ openMicros?: number; wonMicros?: number }> } | null;
  isError?: boolean;
  isLoading?: boolean;
  isPending?: boolean;
  fetchStatus?: 'fetching' | 'paused' | 'idle';
  status?: 'pending' | 'error' | 'success';
}

function hasOpenOrWon(snapshot: ForecastProjectionReadSnapshot): boolean {
  const periods = snapshot.data?.periods;
  if (!periods || periods.length === 0) return false;
  return periods.some((period) => (period.openMicros ?? 0) > 0 || (period.wonMicros ?? 0) > 0);
}

export function forecastProjectionPhase(
  snapshot: ForecastProjectionReadSnapshot,
): ForecastProjectionPhase {
  const hasPayload = snapshot.data != null;
  // isLoading is only true while the first fetch is in flight and nothing
  // has arrived. A paused first read is pending with isLoading false.
  // A failed read stays failed even when a later flag still says loading.
  if (snapshot.isError === true || snapshot.status === 'error') return 'failed';
  if (snapshot.isLoading === true && !hasPayload) return 'unread';
  if (hasPayload) return hasOpenOrWon(snapshot) ? 'ready' : 'empty';
  if (
    snapshot.status === 'pending' ||
    snapshot.isPending === true ||
    snapshot.fetchStatus === 'paused' ||
    snapshot.fetchStatus === 'fetching'
  ) {
    return 'unread';
  }
  if (snapshot.status === 'success') return 'empty';
  return 'unread';
}
