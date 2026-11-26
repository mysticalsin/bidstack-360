export type TopAccountsReadPhase = 'error' | 'unread' | 'ready';

/**
 * Error wins. A missing payload has not arrived, including a paused read
 * where isLoading is false. A settled null or a settled list is ready.
 */
export function topAccountsReadPhase(query: {
  isError?: boolean;
  status?: string;
  data: unknown;
}): TopAccountsReadPhase {
  if (query.isError === true || query.status === 'error') return 'error';
  if (query.data === undefined) return 'unread';
  return 'ready';
}
