// The weighted pipeline may paint only after the read arrives.
// A pause has isLoading false and no payload. That read is still unread.
// Error wins, then undefined data is unread, else the read is ready.

export type ForecastProjectionPhase = 'unread' | 'failed' | 'ready';

export interface ForecastProjectionSnapshot {
  data?: unknown;
  isError?: boolean;
  status?: string;
}

export function forecastProjectionPhase(
  snapshot: ForecastProjectionSnapshot,
): ForecastProjectionPhase {
  if (snapshot.isError === true || snapshot.status === 'error') return 'failed';
  if (snapshot.data === undefined) return 'unread';
  return 'ready';
}
