// The staffing dialog may quote a cross-account total only after that number
// arrives. A pause has no total. A body without totalPct is not 0%. An error
// without a number is a failed read. A number that arrived stays, including 0.

export type AllocationReadPhase = 'unread' | 'failed' | 'ready';

export interface AllocationReadSnapshot {
  data?: { totalPct?: unknown } | null;
  isError?: boolean;
  status?: string;
}

export function allocationReadPhase(snapshot: AllocationReadSnapshot): AllocationReadPhase {
  const total =
    snapshot.data && typeof snapshot.data === 'object' ? snapshot.data.totalPct : undefined;
  if (typeof total === 'number' && Number.isFinite(total)) return 'ready';
  if (snapshot.isError === true || snapshot.status === 'error') return 'failed';
  if (snapshot.data !== undefined) return 'failed';
  return 'unread';
}
