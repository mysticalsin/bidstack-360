// A governance record may say "No gate decisions recorded yet" only after
// the gate-decision payload arrives. A pause has isLoading false and no
// items. That read is still unread. A failure is not an empty record. An
// arrived list with no rows is empty.

export type GateRecordPhase = 'idle' | 'loading' | 'unread' | 'empty' | 'failed' | 'ready';

export interface GateRecordSnapshot {
  opportunityId?: string;
  data?: { items?: readonly unknown[] } | null;
  isLoading?: boolean;
  isError?: boolean;
  status?: string;
}

export function gateRecordPhase(snapshot: GateRecordSnapshot): GateRecordPhase {
  if (!snapshot.opportunityId) return 'idle';
  if (snapshot.isError === true || snapshot.status === 'error') return 'failed';
  if (snapshot.data != null) {
    return (snapshot.data.items?.length ?? 0) === 0 ? 'empty' : 'ready';
  }
  if (snapshot.isLoading === true) return 'loading';
  return 'unread';
}
