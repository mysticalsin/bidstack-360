import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import type { Workflow, WorkflowCreate, WorkflowRun } from '@bidstack/shared';

const KEY = 'workflows';

export function useWorkflows(active?: boolean) {
  return useQuery<{ items: Workflow[] }>({
    queryKey: [KEY, active],
    queryFn: ({ signal }) => {
      const params = new URLSearchParams();
      if (active !== undefined) params.set('active', String(active));
      const path = `/api/workflows${params.toString() ? `?${params.toString()}` : ''}`;
      return api(path, { signal });
    },
  });
}

export function useCreateWorkflow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: WorkflowCreate) => api<Workflow>('/api/workflows', { method: 'POST', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
}

export function useUpdateWorkflow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & Partial<WorkflowCreate>) =>
      api<Workflow>(`/api/workflows/${id}`, { method: 'PATCH', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
}

export function useDeleteWorkflow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<null>(`/api/workflows/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
}

export function useRunWorkflow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<WorkflowRun>(`/api/workflows/${id}/run`, { method: 'POST', body: { input: {} } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
}
