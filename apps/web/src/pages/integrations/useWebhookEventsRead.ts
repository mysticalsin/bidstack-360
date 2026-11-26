import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';

import type { WebhookEvent } from './types';

/** Page the integrations event list draws. */
export interface WebhookEventReadPage {
  items: WebhookEvent[];
  pageContinues: boolean;
}

/**
 * Same cache key as the settings event list, so the hero figure shares that
 * read instead of opening a second request.
 */
export function useWebhookEventsRead() {
  return useQuery({
    queryKey: ['webhooks'],
    queryFn: ({ signal }) =>
      api<WebhookEventReadPage>('/api/integrations/webhooks', { signal }),
  });
}
