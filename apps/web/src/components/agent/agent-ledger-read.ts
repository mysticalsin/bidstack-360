export type AgentLedgerPhase = 'error' | 'unread' | 'ready';

/**
 * Error wins. A payload that has not arrived is unread, even when isLoading
 * is false. A settled value, including null, is ready.
 */
export function agentLedgerPhase(query: {
  isError: boolean;
  data: unknown;
}): AgentLedgerPhase {
  if (query.isError) return 'error';
  if (query.data === undefined) return 'unread';
  return 'ready';
}

/** Error wins across the page of bid-fact reads. Undefined data is unread. */
export function agentLedgerQueriesPhase(
  queries: { isError: boolean; data: unknown }[],
): AgentLedgerPhase {
  let phase: AgentLedgerPhase = 'ready';
  for (const query of queries) {
    const next = agentLedgerPhase(query);
    if (next === 'error') return 'error';
    if (next === 'unread') phase = 'unread';
  }
  return phase;
}
