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

export function useWebhookSubscriptions() {
  return useQuery({
    queryKey: ['webhook-subscriptions'],
    queryFn: ({ signal }) => api<WebhookSub[]>('/api/v1/webhook-subscriptions', { signal }),
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
    mutationFn: (body: { url: string; events: string[]; active?: boolean }) =>
      api<WebhookSub>('/api/v1/webhook-subscriptions', {
        method: 'POST',
        body,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['webhook-subscriptions'] }),
  });
}

export function useUpdateWebhookSubscription(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<Pick<WebhookSub, 'url' | 'events' | 'active'>>) =>
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
  return useMutation({
    mutationFn: (id: string) =>
      api<TestPingResult>(`/api/v1/webhook-subscriptions/${id}/test`, { method: 'POST' }),
  });
}
