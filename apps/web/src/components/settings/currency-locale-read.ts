// The currency and locale form may show only after the read arrives.
// A pause has isLoading false and no settings. That read is still unread.
// Error wins, then undefined data is unread, else the read is ready.

export type CurrencyLocalePhase = 'unread' | 'failed' | 'ready';

export interface CurrencyLocaleSnapshot {
  data?: unknown;
  isError?: boolean;
  status?: string;
}

export function currencyLocalePhase(snapshot: CurrencyLocaleSnapshot): CurrencyLocalePhase {
  if (snapshot.isError === true || snapshot.status === 'error') return 'failed';
  if (snapshot.data === undefined) return 'unread';
  return 'ready';
}
