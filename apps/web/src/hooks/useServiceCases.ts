import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import type { ServiceCase, ServiceCaseCreate, CaseStatus, CasePriority } from '@bidstack/shared';

interface ServiceCasesParams {
  search?: string;
  status?: CaseStatus;
  priority?: CasePriority;
  limit?: number;
  cursor?: string;
}

type ServiceCasesPayload = { items: ServiceCase[]; nextCursor: string | null };

export function useServiceCases(params: ServiceCasesParams = {}) {
  return useQuery({
    queryKey: ['service-cases', params],
    queryFn: ({ signal }) => {
      const usp = new URLSearchParams();
      if (params.search) usp.set('search', params.search);
      if (params.status) usp.set('status', params.status);
      if (params.priority) usp.set('priority', params.priority);
      if (params.cursor) usp.set('cursor', params.cursor);
      if (params.limit) usp.set('limit', String(params.limit));
      const path = `/api/service-cases${usp.toString() ? `?${usp.toString()}` : ''}`;
      return api<ServiceCasesPayload>(path, { signal });
    },
  });
}

export function useServiceCase(id: string | undefined) {
  return useQuery({
    queryKey: ['service-case', id],
    queryFn: ({ signal }) => api<ServiceCase>(`/api/service-cases/${id}`, { signal }),
    enabled: Boolean(id),
    staleTime: 30_000,
  });
}

export function useCreateServiceCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ServiceCaseCreate) =>
      api<ServiceCase>('/api/service-cases', { method: 'POST', body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['service-cases'] }),
  });
}

export function useUpdateServiceCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<ServiceCaseCreate> }) =>
      api<ServiceCase>(`/api/service-cases/${id}`, { method: 'PATCH', body }),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ['service-cases'] });
      void qc.invalidateQueries({ queryKey: ['service-case', vars.id] });
    },
  });
}

export function useDeleteServiceCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<null>(`/api/service-cases/${id}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['service-cases'] }),
  });
}
