export type TaskDetailPhase = 'unread' | 'failed' | 'ready';

// Error wins. A payload that has not arrived is unread. Undefined data is the
// read that has not arrived. A settled null payload is ready.
export function taskDetailPhase(snapshot: {
  data?: unknown;
  isError?: boolean;
  status?: string;
}): TaskDetailPhase {
  if (snapshot.isError === true || snapshot.status === 'error') return 'failed';
  if (snapshot.data === undefined) return 'unread';
  return 'ready';
}
