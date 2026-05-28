import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  AgentConfig,
  AgentProvider,
  RfpAgentTemplate,
  RfpResponsePhaseDefinition,
  RfpAgentAssignment,
  RfpAgentAssignmentWithAgent,
  RfpAgentOutput,
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

export function useRfpAgentAssignments(rfpRequestId: string | undefined) {
  return useQuery<{ items: RfpAgentAssignmentWithAgent[] }>({
    queryKey: ['rfp-assignments', rfpRequestId],
    queryFn: async ({ signal }) => api(`/api/v1/rfp/${rfpRequestId}/assignments`, { signal }),
    enabled: Boolean(rfpRequestId),
  });
}

export function useAssignAgentToRfp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ agentId, rfpRequestId }: { agentId: string; rfpRequestId: string }) =>
      api<RfpAgentAssignment>(`/api/v1/rfp/${rfpRequestId}/assignments`, {
        method: 'POST',
        body: { agentId },
      }),
    onSuccess: (_data, variables) => {
      void qc.invalidateQueries({ queryKey: ['rfp-assignments', variables.rfpRequestId] });
    },
  });
}

export function useUnassignAgentFromRfp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      assignmentId,
      rfpRequestId,
    }: {
      assignmentId: string;
      rfpRequestId: string;
    }) =>
      api<{ success: boolean }>(`/api/v1/rfp/${rfpRequestId}/assignments/${assignmentId}`, {
        method: 'DELETE',
      }),
    onSuccess: (_data, variables) => {
      void qc.invalidateQueries({ queryKey: ['rfp-assignments', variables.rfpRequestId] });
    },
  });
}

export function useRfpAgentOutputs(rfpRequestId: string | undefined) {
  return useQuery<{ items: RfpAgentOutput[] }>({
    queryKey: ['rfp-outputs', rfpRequestId],
    queryFn: async ({ signal }) => api(`/api/v1/rfp/${rfpRequestId}/outputs`, { signal }),
    enabled: Boolean(rfpRequestId),
  });
}

export function useApproveOutput() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ rfpRequestId, outputId }: { rfpRequestId: string; outputId: string }) =>
      api<{ success: boolean }>(`/api/v1/rfp/${rfpRequestId}/outputs/${outputId}/approve`, {
        method: 'POST',
      }),
    onSuccess: (_data, variables) => {
      void qc.invalidateQueries({ queryKey: ['rfp-outputs', variables.rfpRequestId] });
    },
  });
}

export function useRejectOutput() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      rfpRequestId,
      outputId,
      reason,
    }: {
      rfpRequestId: string;
      outputId: string;
      reason: string;
    }) =>
      api<{ success: boolean }>(`/api/v1/rfp/${rfpRequestId}/outputs/${outputId}/reject`, {
        method: 'POST',
        body: { reason },
      }),
    onSuccess: (_data, variables) => {
      void qc.invalidateQueries({ queryKey: ['rfp-outputs', variables.rfpRequestId] });
    },
  });
}
