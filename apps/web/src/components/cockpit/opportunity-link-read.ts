export type OpportunityLinkPhase = 'error' | 'unread' | 'ready';

/**
 * Error wins. A payload that has not arrived is unread, even when isLoading
 * is false. A settled value, including null, is ready.
 */
export function opportunityLinkPhase(query: {
  isError: boolean;
  data: unknown;
}): OpportunityLinkPhase {
  if (query.isError) return 'error';
  if (query.data === undefined) return 'unread';
  return 'ready';
}
