// A starter template catalog may show no templates only after the payload
// arrives. A pause has isLoading false and no rows. That read is still unread.
// A failure with no payload is not an empty catalog.

export type TemplateCatalogPhase = 'unread' | 'failed' | 'ready';

export interface TemplateCatalogReadSnapshot {
  data?: unknown;
  isError?: boolean;
  status?: string;
}

export function templateCatalogPhase(snapshot: TemplateCatalogReadSnapshot): TemplateCatalogPhase {
  if (snapshot.data !== undefined) return 'ready';
  if (snapshot.isError === true || snapshot.status === 'error') return 'failed';
  return 'unread';
}
