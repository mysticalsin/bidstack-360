// The workspace currency sync may apply a code only after the locale read arrives.
// A pause has isLoading false and no payload. That read is still unread.
// Error wins, then undefined data is unread, else the read is ready.

export type OrgCurrencyPhase = 'unread' | 'failed' | 'ready';

export interface OrgCurrencySnapshot {
  data?: unknown;
  isError?: boolean;
  status?: string;
}

export function orgCurrencyPhase(snapshot: OrgCurrencySnapshot): OrgCurrencyPhase {
  if (snapshot.isError === true || snapshot.status === 'error') return 'failed';
  if (snapshot.data === undefined) return 'unread';
  return 'ready';
}
