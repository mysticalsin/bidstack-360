import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { WebhookMessageStatus, WebhookRetryPolicy } from '@bidstack/shared';

import { api } from '@/lib/api';

export type WebhookStatsWindow = '24h' | '7d' | '30d';

export interface WebhookDeliveryFilters {
  subscriptionId?: string;
  event?: string;
  status?: WebhookMessageStatus;
  window?: WebhookStatsWindow;
}

export interface WebhookMessageRow {
  id: string;
  subscriptionId: string;
  url: string;
  event: string;
  status: WebhookMessageStatus;
  attempts: number;
  lastStatusCode: number | null;
  lastDurationMs: number | null;
  replayOfId: string | null;
  createdAt: string;
}

export interface WebhookAttempt {
  id: string;
  attempt: number;
  statusCode: number | null;
  success: boolean;
  durationMs: number | null;
  errorMessage: string | null;
  requestHeaders: Record<string, string>;
  responseBody: string | null;
  responseTruncated: boolean;
  createdAt: string;
}

export interface WebhookMessageDetail {
  message: WebhookMessageRow;
  requestBody: string;
  requestBodyTruncated: boolean;
  attempts: WebhookAttempt[];
}

export interface WebhookDeliveryStats {
  messages: { total: number; succeeded: number; failed: number; pending: number };
  successRate: number | null;
  heatmap: Array<{ subscriptionId: string; hour: number; attempts: number; failures: number }>;
  latencyMs: number[];
}

const WINDOW_HOURS: Record<WebhookStatsWindow, number> = { '24h': 24, '7d': 168, '30d': 720 };

function query(params: Record<string, string | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  const s = q.toString();
  return s ? `?${s}` : '';
}

export function useWebhookMessages(filters: WebhookDeliveryFilters, cursor?: string | null) {
  return useQuery({
    queryKey: ['webhook-messages', filters, cursor ?? null],
    queryFn: ({ signal }) => {
      const from = filters.window
        ? new Date(Date.now() - WINDOW_HOURS[filters.window] * 3_600_000).toISOString()
        : undefined;
      return api<{ items: WebhookMessageRow[]; nextCursor: string | null }>(
        `/api/v1/webhook-messages${query({
          subscriptionId: filters.subscriptionId,
          event: filters.event,
          status: filters.status,
          from,
          cursor: cursor ?? undefined,
          limit: '50',
        })}`,
        { signal },
      );
    },
  });
}

export function useWebhookMessage(id: string | null) {
  return useQuery({
    queryKey: ['webhook-message', id],
    queryFn: ({ signal }) =>
      api<WebhookMessageDetail>(`/api/v1/webhook-messages/${id}`, { signal }),
    enabled: Boolean(id),
  });
}

export function useReplayWebhookMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, requestId }: { id: string; requestId: string }) =>
      api<{ outboxId: string; duplicate: boolean }>(`/api/v1/webhook-messages/${id}/replay`, {
        method: 'POST',
        body: { requestId },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['webhook-messages'] }),
  });
}

export function useWebhookDeliveryStats(filters: WebhookDeliveryFilters) {
  return useQuery({
    queryKey: ['webhook-delivery-stats', filters],
    queryFn: ({ signal }) =>
      api<WebhookDeliveryStats>(
        `/api/v1/webhook-deliveries/stats${query({
          subscriptionId: filters.subscriptionId,
          event: filters.event,
          status: filters.status,
          window: filters.window ?? '24h',
        })}`,
        { signal },
      ),
  });
}

export function useWebhookRetryPolicy(subscriptionId: string | null) {
  return useQuery({
    queryKey: ['webhook-retry-policy', subscriptionId],
    queryFn: ({ signal }) =>
      api<WebhookRetryPolicy>(`/api/v1/webhook-subscriptions/${subscriptionId}/retry-policy`, {
        signal,
      }),
    enabled: Boolean(subscriptionId),
  });
}

export function useSaveWebhookRetryPolicy(subscriptionId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (policy: WebhookRetryPolicy) =>
      api<WebhookRetryPolicy>(`/api/v1/webhook-subscriptions/${subscriptionId}/retry-policy`, {
        method: 'PUT',
        body: policy,
      }),
    onSuccess: (saved) => {
      qc.setQueryData(['webhook-retry-policy', subscriptionId], saved);
      void qc.invalidateQueries({ queryKey: ['webhook-subscriptions'] });
    },
  });
}

export function useResetWebhookRetryPolicy(subscriptionId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api<WebhookRetryPolicy>(`/api/v1/webhook-subscriptions/${subscriptionId}/retry-policy`, {
        method: 'DELETE',
      }),
    onSuccess: (saved) => {
      qc.setQueryData(['webhook-retry-policy', subscriptionId], saved);
      void qc.invalidateQueries({ queryKey: ['webhook-subscriptions'] });
    },
  });
}

export function useRotateWebhookSecret() {
  return useMutation({
    mutationFn: ({ id, overlapHours }: { id: string; overlapHours: number }) =>
      api<{ signingSecret: string; previousSecretExpiresAt: string | null }>(
        `/api/v1/webhook-subscriptions/${id}/rotate-secret`,
        { method: 'POST', body: { overlapHours } },
      ),
  });
}
