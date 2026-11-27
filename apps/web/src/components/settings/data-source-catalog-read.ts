// The data-source catalog may list providers only after the read arrives.
// A pause has isLoading false and no payload. That read is still unread.
// Error wins, then undefined data is unread, else an empty list stays empty.

export type DataSourceCatalogPhase = 'unread' | 'failed' | 'empty' | 'ready';

export interface DataSourceCatalogSnapshot {
  data?: { items?: readonly unknown[] } | null;
  isError?: boolean;
  status?: string;
}

export function dataSourceCatalogPhase(
  snapshot: DataSourceCatalogSnapshot,
): DataSourceCatalogPhase {
  if (snapshot.isError === true || snapshot.status === 'error') return 'failed';
  if (snapshot.data === undefined) return 'unread';
  const items = snapshot.data?.items;
  if (!items || items.length === 0) return 'empty';
  return 'ready';
}
