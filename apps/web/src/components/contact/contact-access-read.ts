// The contact dialog may offer Save or Create only after the access read arrives.
// A pause has isLoading false and no manifest. That read is still unread.
// Error wins, then undefined data is unread, else the read is ready.

export type ContactAccessPhase = 'unread' | 'failed' | 'ready';

export interface ContactAccessSnapshot {
  data?: unknown;
  isError?: boolean;
  status?: string;
}

export function contactAccessPhase(snapshot: ContactAccessSnapshot): ContactAccessPhase {
  if (snapshot.isError === true || snapshot.status === 'error') return 'failed';
  if (snapshot.data === undefined) return 'unread';
  return 'ready';
}

export function contactsWriteAllowed(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false;
  const row = data as { isAdmin?: boolean; permissions?: unknown };
  if (row.isAdmin === true) return true;
  return Array.isArray(row.permissions) && row.permissions.includes('contacts:write');
}
