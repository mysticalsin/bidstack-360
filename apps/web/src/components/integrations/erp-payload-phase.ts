// An ERP read may say "not configured", "local", or "none" only after a
// payload arrives. A pause has isLoading false and no data. That read is
// still unread. A failure is not a local kit.

export type ErpPayloadPhase = 'unread' | 'failed' | 'ready';

export interface ErpPayloadSnapshot {
  data?: unknown;
  isError?: boolean;
  status?: 'pending' | 'error' | 'success';
}

export function erpPayloadPhase(snapshot: ErpPayloadSnapshot): ErpPayloadPhase {
  if (snapshot.data !== undefined) return 'ready';
  if (snapshot.isError === true || snapshot.status === 'error') return 'failed';
  return 'unread';
}
