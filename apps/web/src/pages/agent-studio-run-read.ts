// A crew run may show a status only after the run payload arrives. A pause
// has no data. That read is still unread. A failure is not a queued run.

export type AgentStudioRunPhase = 'unread' | 'failed' | 'ready';

export interface AgentStudioRunSnapshot {
  data?: unknown;
  isError?: boolean;
  status?: 'pending' | 'error' | 'success';
}

export function agentStudioRunPhase(snapshot: AgentStudioRunSnapshot): AgentStudioRunPhase {
  if (snapshot.isError === true || snapshot.status === 'error') return 'failed';
  if (snapshot.data === undefined) return 'unread';
  return 'ready';
}
