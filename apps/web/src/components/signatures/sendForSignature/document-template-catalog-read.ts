// A document template catalog may show an empty menu only after the payload
// arrives. A pause has isLoading false and no rows. That read is still unread.
// A failure with no payload is not an empty catalog.

export type DocumentTemplateCatalogPhase = 'unread' | 'failed' | 'ready';

export interface DocumentTemplateCatalogReadSnapshot {
  data?: unknown;
  isError?: boolean;
  status?: string;
}

export function documentTemplateCatalogPhase(
  snapshot: DocumentTemplateCatalogReadSnapshot,
): DocumentTemplateCatalogPhase {
  if (snapshot.data !== undefined) return 'ready';
  if (snapshot.isError === true || snapshot.status === 'error') return 'failed';
  return 'unread';
}
