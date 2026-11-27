// The stage-gate form may show only after the read arrives.
// A pause has isLoading false and no setting. That read is still unread.
// Error wins, then undefined data is unread, else the read is ready.

export type StageGatePhase = 'unread' | 'failed' | 'ready';

export interface StageGateSnapshot {
  data?: unknown;
  isError?: boolean;
  status?: string;
}

export function stageGatePhase(snapshot: StageGateSnapshot): StageGatePhase {
  if (snapshot.isError === true || snapshot.status === 'error') return 'failed';
  if (snapshot.data === undefined) return 'unread';
  return 'ready';
}
