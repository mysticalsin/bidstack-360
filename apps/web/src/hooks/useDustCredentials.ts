import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';

/** Masked, client-safe view of an org's Dust credentials — never the key. */
export interface DustCredentialsSummary {
  configured: boolean;
  /** 'org' = saved in Settings; 'env' = the platform default; null = unconfigured. */
  source: 'org' | 'env' | null;
  workspaceId: string | null;
  baseUrl: string | null;
  dataSourceId: string | null;
  agentIds: Record<string, string>;
  /** Last 4 chars only, and only for the org's own key. */
  apiKeyMasked: string | null;
}

export interface DustCredentialsInput {
  apiKey: string;
  workspaceId: string;
  baseUrl?: string;
  dataSourceId?: string;
}

const KEY = ['dust:credentials'];

export function useDustCredentials() {
  return useQuery({
    queryKey: KEY,
    queryFn: ({ signal }) =>
      api<DustCredentialsSummary>('/api/integrations/dust/credentials', { signal }),
    retry: false,
    refetchOnWindowFocus: false,
  });
}

function invalidate(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: KEY });
  // The status card reads the same credentials — keep it in sync.
  void qc.invalidateQueries({ queryKey: ['dust:status'] });
}

export function useSaveDustCredentials() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: DustCredentialsInput) =>
      api<DustCredentialsSummary>('/api/integrations/dust/credentials', {
        method: 'PUT',
        body: input,
      }),
    onSuccess: () => invalidate(qc),
  });
}

export function useRemoveDustCredentials() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<null>('/api/integrations/dust/credentials', { method: 'DELETE' }),
    onSuccess: () => invalidate(qc),
  });
}
