// An agent studio list may say "No agents yet" or "No crews yet" only after
// the payload arrives. A pause has isLoading false and no rows. That read is
// still unread. A failure is not an empty catalog.

export type AgentStudioListPhase = 'unread' | 'failed' | 'ready';

export interface AgentStudioListSnapshot {
  data?: unknown;
  isError?: boolean;
  status?: 'pending' | 'error' | 'success';
}

export function agentStudioListPhase(snapshot: AgentStudioListSnapshot): AgentStudioListPhase {
  if (snapshot.isError === true || snapshot.status === 'error') return 'failed';
  if (snapshot.data === undefined) return 'unread';
  return 'ready';
}
