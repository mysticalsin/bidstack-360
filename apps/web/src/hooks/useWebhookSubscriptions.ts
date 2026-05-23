import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface WebhookSub {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  createdAt: string;
}

export function useWebhookSubscriptions() {
  return useQuery({
    queryKey: ['webhook-subscriptions'],
    queryFn: ({ signal }) => api<WebhookSub[]>('/api/webhook-subscriptions', { signal }),
  });
}

export function useCreateWebhookSubscription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { url: string; events: string[]; active?: boolean }) =>
      api<WebhookSub>('/api/webhook-subscriptions', {
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
      api<WebhookSub>(`/api/webhook-subscriptions/${id}`, {
        method: 'PATCH',
        body,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['webhook-subscriptions'] }),
  });
}

export function useDeleteWebhookSubscription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/api/webhook-subscriptions/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['webhook-subscriptions'] }),
  });
}
