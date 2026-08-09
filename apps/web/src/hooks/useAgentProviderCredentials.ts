import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';

// Kept in sync with DIRECT_AGENT_PROVIDERS in @bidstack/shared/llm. 'omniroute'
// is the keyless free AI gateway (localhost:20128) and, like 'gemma', needs no key.
export type DirectAgentProvider =
  | 'omniroute'
  | 'claude'
  | 'openai'
  | 'kimi'
  | 'nvidia_nim'
  | 'gemma';

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

export interface AgentProviderList {
  items: AgentProviderCredentialSummary[];
  active: DirectAgentProvider | null;
}

export interface AgentProviderTestResult {
  provider: DirectAgentProvider;
  ok: boolean;
  model: string | null;
  latencyMs: number;
  error: string | null;
}

const KEY = ['agent-provider-credentials'];

export function useAgentProviderCredentials() {
  return useQuery({
    queryKey: KEY,
    queryFn: ({ signal }) =>
      api<AgentProviderList>('/api/integrations/agent-providers/credentials', { signal }),
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

// Switch the org's active default provider (or null to clear). Returns the full
// refreshed list so the cache updates active badges in one round-trip.
export function useSetActiveAgentProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (provider: DirectAgentProvider | null) =>
      api<AgentProviderList>('/api/integrations/agent-providers/active', {
        method: 'PUT',
        body: { provider },
      }),
    onSuccess: (data) => {
      qc.setQueryData(KEY, data);
      invalidate(qc);
    },
  });
}

// Live "is it alive?" probe — sends a minimal completion to the stored key.
export function useTestAgentProvider() {
  return useMutation({
    mutationFn: (provider: DirectAgentProvider) =>
      api<AgentProviderTestResult>(
        `/api/integrations/agent-providers/credentials/${provider}/test`,
        { method: 'POST' },
      ),
  });
}
