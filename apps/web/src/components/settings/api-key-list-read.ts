// The API key list may say it is empty only after the payload arrives. A
// pause has isLoading false and no items. That read is still unread. A
// failure with no payload is not an empty key list.

export type ApiKeyListPhase = 'unread' | 'failed' | 'ready';

export interface ApiKeyListSnapshot {
  data?: unknown;
  isError?: boolean;
  status?: string;
}

export function apiKeyListPhase(snapshot: ApiKeyListSnapshot): ApiKeyListPhase {
  if (snapshot.data !== undefined) return 'ready';
  if (snapshot.isError === true || snapshot.status === 'error') return 'failed';
  return 'unread';
}
