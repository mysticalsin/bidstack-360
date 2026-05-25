import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';

export interface Mention {
  id: string;
  orgId: string;
  commentId: string;
  userId: string;
  readAt: string | null;
  createdAt: string;
}

export function useMentions(unreadOnly?: boolean, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ['mentions', unreadOnly ?? false],
    queryFn: ({ signal }) =>
      api<{ items: Mention[] }>(`/api/mentions${unreadOnly ? '?unreadOnly=true' : ''}`, { signal }),
    enabled: options.enabled ?? true,
    staleTime: 30_000,
  });
}

export function useMentionSummary() {
  return useQuery({
    queryKey: ['mentions', 'summary'],
    queryFn: ({ signal }) => api<{ unread: number }>('/api/mentions/summary', { signal }),
    staleTime: 30_000,
  });
}

export function useMarkMentionRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<Mention>(`/api/mentions/${id}/read`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mentions'] });
      qc.invalidateQueries({ queryKey: ['mentions', 'summary'] });
    },
  });
}
