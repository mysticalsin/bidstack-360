import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  AgentConfig,
  AgentProvider,
  RfpAgentTemplate,
  RfpResponsePhaseDefinition,
} from '@bidstack/shared';
import { api } from '@/lib/api';

export interface Agent {
  id: string;
  orgId: string;
  name: string;
  description: string | null;
  systemPrompt: string;
  tools: Record<string, unknown>[];
  status: 'idle' | 'running' | 'error' | 'disabled';
  scheduleCron: string | null;
  lastRunAt: string | null;
  config: AgentConfig;
  createdAt: string;
  updatedAt: string;
}

export interface AgentRun {
  id: string;
  orgId: string;
  agentId: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  costMicros: string | null;
  latencyMs: number | null;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

export function useAgents() {
  return useQuery<{ items: Agent[]; nextCursor?: string }>({
    queryKey: ['agents'],
    queryFn: async ({ signal }) => api('/api/agents', { signal }),
  });
}

export function useRfpAgentTemplates() {
  return useQuery<{ phases: RfpResponsePhaseDefinition[]; templates: RfpAgentTemplate[] }>({
    queryKey: ['agents', 'rfp-templates'],
    queryFn: async ({ signal }) => api('/api/agents/rfp-templates', { signal }),
    staleTime: 10 * 60 * 1000,
  });
}

export function useAgent(id: string | undefined) {
  return useQuery<Agent>({
    queryKey: ['agent', id],
    queryFn: async ({ signal }) => api(`/api/agents/${id}`, { signal }),
    enabled: Boolean(id),
  });
}

export function useCreateAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: {
      name: string;
      description?: string | null;
      systemPrompt: string;
      tools?: Record<string, unknown>[];
      scheduleCron?: string | null;
      config?: Record<string, unknown>;
    }) => api<Agent>('/api/agents', { method: 'POST', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agents'] }),
  });
}

export function useProvisionRfpAgentTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      templateId,
      ...body
    }: {
      templateId: string;
      name?: string;
      provider?: AgentProvider;
      dustAgentId?: string;
      model?: string;
      enabledTools?: string[];
    }) =>
      api<Agent>(`/api/agents/rfp-templates/${templateId}/provision`, {
        method: 'POST',
        body,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agents'] }),
  });
}

export function useUpdateAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...patch }: { id: string } & Partial<Agent>) =>
      api<Agent>(`/api/agents/${id}`, { method: 'PATCH', body: patch }),
    onSuccess: (_data, variables) => {
      void qc.invalidateQueries({ queryKey: ['agents'] });
      void qc.invalidateQueries({ queryKey: ['agent', variables.id] });
    },
  });
}

export function useDeleteAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => api(`/api/agents/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agents'] }),
  });
}

export function useRunAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input?: Record<string, unknown> }) =>
      api<AgentRun>(`/api/agents/${id}/run`, { method: 'POST', body: { input } }),
    onSuccess: (_data, variables) => {
      void qc.invalidateQueries({ queryKey: ['agents'] });
      void qc.invalidateQueries({ queryKey: ['agent-runs'] });
      void qc.invalidateQueries({ queryKey: ['agent-runs', variables.id] });
    },
  });
}

export function useAgentRuns(agentId?: string) {
  return useQuery<{ items: AgentRun[]; nextCursor?: string }>({
    queryKey: agentId ? ['agent-runs', agentId] : ['agent-runs'],
    queryFn: async ({ signal }) =>
      api(agentId ? `/api/agents/${agentId}/runs` : '/api/agent-runs', { signal }),
  });
}
