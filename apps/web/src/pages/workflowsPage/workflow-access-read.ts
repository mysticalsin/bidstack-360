// Workflow run controls may say the grant is missing only after the
// capabilities payload arrives. A pause has no manifest. That read is still
// unread. A failure is not a denial, and it does not make Run available.

export type WorkflowAccessPhase = 'unread' | 'failed' | 'allowed' | 'denied';

export interface WorkflowAccessSnapshot {
  data?: { isAdmin?: boolean; permissions?: readonly string[] } | undefined;
  isError?: boolean;
  status?: 'pending' | 'error' | 'success';
}

export function workflowAccessPhase(
  snapshot: WorkflowAccessSnapshot,
  permission: string,
): WorkflowAccessPhase {
  if (snapshot.isError === true || snapshot.status === 'error') return 'failed';
  if (snapshot.data === undefined) return 'unread';
  const granted =
    snapshot.data.isAdmin === true || snapshot.data.permissions?.includes(permission) === true;
  return granted ? 'allowed' : 'denied';
}
