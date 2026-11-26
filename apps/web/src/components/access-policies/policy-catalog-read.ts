/**
 * Role and team catalogs on an access-policy rule.
 * A missing payload is not an empty catalog. A failed read is not an empty
 * catalog. A settled empty list stays empty. Names that already arrived stay.
 */
export interface CatalogRead {
  status: 'pending' | 'error' | 'success';
  fetchStatus: 'idle' | 'fetching' | 'paused';
  /** Present only once a payload exists. An empty array is a settled empty list. */
  items?: readonly string[];
}

export type CatalogPhase = 'unread' | 'failed' | 'empty' | 'ready';

export function catalogPhase(read: CatalogRead): CatalogPhase {
  const arrived = !!read.items && read.items.length > 0;
  // A paused retry has not arrived yet. A payload already in hand stays.
  if (read.fetchStatus === 'paused' && !arrived) return 'unread';
  if (read.status === 'success') return arrived ? 'ready' : 'empty';
  if (arrived) return 'ready';
  if (read.status === 'error') return 'failed';
  return 'unread';
}
