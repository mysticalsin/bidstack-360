import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import type { Forecast } from '@bidstack/shared';

export function useForecasts(period?: string) {
  return useQuery({
    queryKey: ['forecasts', period],
    queryFn: ({ signal }) => {
      const params = new URLSearchParams();
      if (period) params.set('period', period);
      return api<{ items: Forecast[] }>(`/api/forecasts?${params.toString()}`, { signal });
    },
  });
}

export function useCreateForecast() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      period: string;
      category: Forecast['category'];
      amountMicros: number;
      currency?: string;
      note?: string;
    }) => api<Forecast>('/api/forecasts', { method: 'POST', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['forecasts'] }),
  });
}

export function useUpdateForecast() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & Partial<Forecast>) =>
      api<Forecast>(`/api/forecasts/${id}`, { method: 'PATCH', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['forecasts'] }),
  });
}

export function useDeleteForecast() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/api/forecasts/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['forecasts'] }),
  });
}
