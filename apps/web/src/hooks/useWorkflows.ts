import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import type { Workflow, WorkflowCreate } from '@bidstack/shared';

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
