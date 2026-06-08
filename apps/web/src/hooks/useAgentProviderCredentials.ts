import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';

export type DirectAgentProvider = 'claude' | 'openai' | 'kimi' | 'nvidia_nim' | 'gemma';

export interface AgentProviderCredentialSummary {
  provider: DirectAgentProvider;
  configured: boolean;
  source: 'org' | null;
  model: string | null;
  baseUrl: string | null;
  apiKeyMasked: string | null;
  updatedAt: string | null;
}

export interface AgentProviderCredentialInput {
  provider: DirectAgentProvider;
  apiKey?: string;
  model?: string;
  baseUrl?: string;
}

const KEY = ['agent-provider-credentials'];

export function useAgentProviderCredentials() {
  return useQuery({
    queryKey: KEY,
    queryFn: ({ signal }) =>
      api<{ items: AgentProviderCredentialSummary[] }>(
        '/api/integrations/agent-providers/credentials',
        { signal },
      ),
    retry: false,
    refetchOnWindowFocus: false,
  });
}

function invalidate(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: KEY });
  void qc.invalidateQueries({ queryKey: ['agents', 'provider-status'] });
}

export function useSaveAgentProviderCredential() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ provider, ...body }: AgentProviderCredentialInput) =>
      api<AgentProviderCredentialSummary>(
        `/api/integrations/agent-providers/credentials/${provider}`,
        { method: 'PUT', body },
      ),
    onSuccess: () => invalidate(qc),
  });
}

export function useRemoveAgentProviderCredential() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (provider: DirectAgentProvider) =>
      api<null>(`/api/integrations/agent-providers/credentials/${provider}`, {
        method: 'DELETE',
      }),
    onSuccess: () => invalidate(qc),
  });
}
