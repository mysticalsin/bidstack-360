import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import type { Forecast, ForecastProjection } from '@bidstack/shared';

/**
 * Pipeline-weighted forecast projection derived from open opportunities.
 * Non-empty whenever open pipeline exists — the page's primary view.
 */
export function useForecastProjection() {
  return useQuery({
    queryKey: ['forecast-projection'],
    queryFn: ({ signal }) => api<ForecastProjection>('/api/forecasts/projection', { signal }),
  });
}

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
      // Target a specific owner's row (the grid edits org-wide rows). Omit to
      // write the caller's own forecast.
      ownerId?: string;
    }) => api<Forecast>('/api/forecasts', { method: 'POST', body }),
    // Also invalidate the projection — it's derived from the same forecast
    // rows, so a create/update/delete here left useForecastProjection's cache
    // stale until an unrelated refetch happened to occur.
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['forecasts'] });
      qc.invalidateQueries({ queryKey: ['forecast-projection'] });
    },
  });
}

export function useUpdateForecast() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & Partial<Forecast>) =>
      api<Forecast>(`/api/forecasts/${id}`, { method: 'PATCH', body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['forecasts'] });
      qc.invalidateQueries({ queryKey: ['forecast-projection'] });
    },
  });
}

export function useDeleteForecast() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/api/forecasts/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['forecasts'] });
      qc.invalidateQueries({ queryKey: ['forecast-projection'] });
    },
  });
}
