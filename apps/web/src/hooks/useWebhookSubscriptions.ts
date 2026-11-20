import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface WebhookSub {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  failureCount: number;
  lastDeliveryAt: string | null;
  lastFailureAt: string | null;
  createdAt: string;
  /** Per-endpoint delivery timeout. Older API builds omit it. */
  timeoutMs?: number;
}

export interface WebhookCreatedSub extends WebhookSub {
  signingSecret: string;
}

export interface WebhookSubscriptionList {
  items: WebhookSub[];
  /** True when one subscription past this page was loaded and dropped. Not a total. */
  pageContinues: boolean;
}

export interface WebhookDeliveryRecord {
  id: string;
  event: string;
  statusCode: number | null;
  success: boolean;
  durationMs: number | null;
  attempt: number;
  errorMessage: string | null;
  createdAt: string;
}

export function useWebhookSubscriptions(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['webhook-subscriptions'],
    queryFn: ({ signal }) =>
      api<WebhookSubscriptionList>('/api/v1/webhook-subscriptions', { signal }),
    enabled: options?.enabled ?? true,
  });
}

export function useWebhookDeliveries(subscriptionId: string) {
  return useQuery({
    queryKey: ['webhook-deliveries', subscriptionId],
    queryFn: ({ signal }) =>
      api<{ data: WebhookDeliveryRecord[]; hasMore: boolean }>(
        `/api/v1/webhook-subscriptions/${subscriptionId}/deliveries?limit=50`,
        { signal },
      ),
    enabled: Boolean(subscriptionId),
  });
}

export function useCreateWebhookSubscription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { url: string; events: string[]; active?: boolean; timeoutMs?: number }) =>
      api<WebhookCreatedSub>('/api/v1/webhook-subscriptions', {
        method: 'POST',
        body,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['webhook-subscriptions'] }),
  });
}

export function useUpdateWebhookSubscription(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<Pick<WebhookSub, 'url' | 'events' | 'active' | 'timeoutMs'>>) =>
      api<WebhookSub>(`/api/v1/webhook-subscriptions/${id}`, {
        method: 'PATCH',
        body,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['webhook-subscriptions'] }),
  });
}

export function useDeleteWebhookSubscription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<void>(`/api/v1/webhook-subscriptions/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['webhook-subscriptions'] }),
  });
}

export interface TestPingResult {
  success: boolean;
  statusCode: number | null;
  durationMs: number;
  error?: string;
}

export function useTestWebhookPing() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<TestPingResult>(`/api/v1/webhook-subscriptions/${id}/test`, { method: 'POST' }),
    onSuccess: (_result, id) => {
      void qc.invalidateQueries({ queryKey: ['webhook-subscriptions'] });
      void qc.invalidateQueries({ queryKey: ['webhook-deliveries', id] });
    },
  });
}
