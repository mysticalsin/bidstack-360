import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PermissionKey } from '@bidstack/shared';

import { api } from '@/lib/api';

export interface ApiKeySummary {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  lastUsedAt: string | null;
  createdAt: string;
}

export interface ApiKeyCreated extends ApiKeySummary {
  /** Plaintext secret — shown ONCE, never returned again. */
  secret: string;
}

export type ApiKeyScope = PermissionKey | 'read' | 'write' | 'mcp';

interface CreateInput {
  name: string;
  scopes: ApiKeyScope[];
}

export function useApiKeys(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ['api-keys'],
    queryFn: ({ signal }) =>
      api<{ items: ApiKeySummary[] }>('/api/integrations/api-keys', { signal }),
    enabled: options.enabled ?? true,
  });
}

export function useCreateApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateInput) =>
      api<ApiKeyCreated>('/api/integrations/api-keys', { method: 'POST', body: input }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['api-keys'] }),
  });
}

export function useRevokeApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<null>(`/api/integrations/api-keys/${id}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['api-keys'] }),
  });
}
