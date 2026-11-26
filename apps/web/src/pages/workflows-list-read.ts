// A workflows list may say "No workflows yet" or count 0 only after the
// payload arrives. A pause has isLoading false and no rows. That read is
// still unread. A failure is not an empty book.

export type WorkflowsListPhase = 'unread' | 'failed' | 'ready';

export interface WorkflowsListSnapshot {
  data?: unknown;
  isError?: boolean;
  status?: 'pending' | 'error' | 'success';
}

export function workflowsListPhase(snapshot: WorkflowsListSnapshot): WorkflowsListPhase {
  if (snapshot.isError === true || snapshot.status === 'error') return 'failed';
  if (snapshot.data === undefined) return 'unread';
  return 'ready';
}
