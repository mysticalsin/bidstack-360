import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import type {
  SalesToolkit,
  SalesToolkitCreate,
  SalesToolkitList,
  SalesToolkitPatch,
} from '@bidstack/shared';

const KEY = ['sales-toolkit-store'];

export interface ToolkitStoreFilters {
  sector?: string;
  category?: string;
  source?: string;
}

/** Stored toolkit collateral (SharePoint-sourced or manual). Live reads. */
export function useSalesToolkitStore(filters?: ToolkitStoreFilters) {
  return useQuery<SalesToolkitList>({
    queryKey: [...KEY, filters ?? {}],
    queryFn: ({ signal }) => {
      const p = new URLSearchParams();
      if (filters?.sector) p.set('sector', filters.sector);
      if (filters?.category) p.set('category', filters.category);
      if (filters?.source) p.set('source', filters.source);
      const qs = p.toString();
      return api<SalesToolkitList>(`/api/sales-toolkits/store${qs ? `?${qs}` : ''}`, { signal });
    },
    staleTime: 0,
    refetchOnMount: 'always',
  });
}

export function useCreateToolkit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SalesToolkitCreate) =>
      api<SalesToolkit>('/api/sales-toolkits/store', { method: 'POST', body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useUpdateToolkit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: SalesToolkitPatch }) =>
      api<SalesToolkit>(`/api/sales-toolkits/store/${id}`, { method: 'PATCH', body: patch }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useDeleteToolkit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<null>(`/api/sales-toolkits/store/${id}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY }),
  });
}

/** Import toolkit files from the configured SharePoint library (Microsoft Graph). */
export function useImportSharePoint() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api<{ configured: boolean; imported: number }>('/api/sales-toolkits/store/import-sharepoint', {
        method: 'POST',
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY }),
  });
}
