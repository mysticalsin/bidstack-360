export type BuyingGroupPhase = 'error' | 'unread' | 'ready';

/**
 * Error wins. A payload that has not arrived is unread, even when isLoading
 * is false. A settled value, including an empty list, is ready.
 */
export function buyingGroupPhase(query: { isError: boolean; data: unknown }): BuyingGroupPhase {
  if (query.isError) return 'error';
  if (query.data === undefined) return 'unread';
  return 'ready';
}
