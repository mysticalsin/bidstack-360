// The custom object list may say "not found" only after the catalog
// settles without this key. A pause, an in-flight fetch, and a failed
// read have no settled miss yet.

export type CustomObjectCatalogPhase = 'unread' | 'failed' | 'missing' | 'ready';

export interface CustomObjectCatalogSnapshot {
  matched?: boolean;
  isError?: boolean;
  isLoading?: boolean;
  isPending?: boolean;
  fetchStatus?: 'fetching' | 'paused' | 'idle';
  status?: 'pending' | 'error' | 'success';
}

export function customObjectCatalogPhase(
  snapshot: CustomObjectCatalogSnapshot,
): CustomObjectCatalogPhase {
  const matched = snapshot.matched === true;
  // isLoading is only true while the first fetch is in flight and nothing
  // has arrived. A paused first read is pending with isLoading false.
  if (snapshot.isLoading === true && !matched) return 'unread';
  if (snapshot.isError === true || snapshot.status === 'error') return 'failed';
  if (matched) return 'ready';
  if (
    snapshot.status === 'pending' ||
    snapshot.isPending === true ||
    snapshot.fetchStatus === 'paused' ||
    snapshot.fetchStatus === 'fetching'
  ) {
    return 'unread';
  }
  return 'missing';
}
