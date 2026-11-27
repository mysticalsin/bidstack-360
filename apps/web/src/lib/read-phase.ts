export type ReadPhase = 'error' | 'unread' | 'ready';

/**
 * Error wins. A payload that has not arrived is unread, even when isLoading
 * is false. A settled value, including null, is ready.
 *
 * An unread company or workspace read is not an empty org and not a failed load.
 */
export function readPhase(query: { isError: boolean; data: unknown }): ReadPhase {
  if (query.isError) return 'error';
  if (query.data === undefined) return 'unread';
  return 'ready';
}
