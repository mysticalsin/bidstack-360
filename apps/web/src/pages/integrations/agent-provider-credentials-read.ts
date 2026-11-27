// The model provider card may say the catalog is empty only after the
// list arrives. A pause has isLoading false and no rows. That read is
// still unread. A failure with no payload is not an empty catalog.

export type AgentProviderCredentialsPhase = 'unread' | 'failed' | 'ready';

export interface AgentProviderCredentialsSnapshot {
  data?: unknown;
  isError?: boolean;
  status?: string;
}

export function agentProviderCredentialsPhase(
  snapshot: AgentProviderCredentialsSnapshot,
): AgentProviderCredentialsPhase {
  if (snapshot.data !== undefined) return 'ready';
  if (snapshot.isError === true || snapshot.status === 'error') return 'failed';
  return 'unread';
}
