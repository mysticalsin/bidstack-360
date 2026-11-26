// The pre-drafting gate may offer Approve only after the capability read arrives.
// A pause has isLoading false and no manifest. That read is still unread.
// Error wins, then undefined data is unread, else the read is ready.

export type DraftAdminPhase = 'unread' | 'failed' | 'ready';

export interface DraftAdminSnapshot {
  data?: unknown;
  isError?: boolean;
  status?: string;
}

export function draftAdminPhase(snapshot: DraftAdminSnapshot): DraftAdminPhase {
  if (snapshot.isError === true || snapshot.status === 'error') return 'failed';
  if (snapshot.data === undefined) return 'unread';
  return 'ready';
}

// settings:write is the org-admin grant the API already uses for this gate.
export function draftAdminGranted(data: unknown): boolean {
  if (data === null || data === undefined || typeof data !== 'object') return false;
  const permissions = (data as { permissions?: unknown }).permissions;
  if (!Array.isArray(permissions)) return false;
  return permissions.includes('settings:write');
}
