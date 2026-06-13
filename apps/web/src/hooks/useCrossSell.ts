import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import type {
  CrossSellAction,
  CrossSellActionCreate,
  CrossSellActionPage,
  CrossSellActionPatch,
} from '@bidstack/shared';

interface Filter {
  accountKey?: string;
  status?: CrossSellAction['status'];
}

function queryString(filter: Filter): string {
  const params = new URLSearchParams();
  if (filter.accountKey) params.set('accountKey', filter.accountKey);
  if (filter.status) params.set('status', filter.status);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export function useCrossSellActions(filter: Filter = {}) {
  return useQuery({
    queryKey: ['cross-sell-actions', filter],
    queryFn: ({ signal }) =>
      api<CrossSellActionPage>(`/api/cross-sell-actions${queryString(filter)}`, { signal }),
  });
}

export function useCreateCrossSellAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CrossSellActionCreate) =>
      api<CrossSellAction>('/api/cross-sell-actions', { method: 'POST', body }),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ['cross-sell-actions'] }),
  });
}

export function usePatchCrossSellAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: CrossSellActionPatch }) =>
      api<CrossSellAction>(`/api/cross-sell-actions/${id}`, { method: 'PATCH', body }),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ['cross-sell-actions'] }),
  });
}

export function useDeleteCrossSellAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api(`/api/cross-sell-actions/${id}`, { method: 'DELETE' }),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ['cross-sell-actions'] }),
  });
}
