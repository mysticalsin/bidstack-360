import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';

export interface DataProviderSummary {
  provider: string;
  label: string;
  description: string;
  docsUrl: string;
  configured: boolean;
  updatedAt: string | null;
}

export interface DataProviderTestResult {
  provider: string;
  ok: boolean;
  latencyMs: number;
  sample: string | null;
  error: string | null;
}

const KEY = ['data-providers'];
const BASE = '/api/integrations/data-providers/credentials';

export function useDataProviders() {
  return useQuery({
    queryKey: KEY,
    queryFn: ({ signal }) => api<{ items: DataProviderSummary[] }>(BASE, { signal }),
    retry: false,
    refetchOnWindowFocus: false,
  });
}

export function useSaveDataProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ provider, apiKey }: { provider: string; apiKey: string }) =>
      api<DataProviderSummary>(`${BASE}/${provider}`, { method: 'PUT', body: { apiKey } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useRemoveDataProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (provider: string) => api<null>(`${BASE}/${provider}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useTestDataProvider() {
  return useMutation({
    mutationFn: (provider: string) =>
      api<DataProviderTestResult>(`${BASE}/${provider}/test`, { method: 'POST' }),
  });
}
