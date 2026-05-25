import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import type { Company, CompanyCreate, CompanyDetail, CompanyPatch, CompanyHierarchy } from '@bidstack/shared';

interface CompaniesParams {
  search?: string;
  industry?: string;
  cursor?: string;
}

type CompaniesPayload = { items: Company[]; nextCursor?: string };

export function useCompany(id: string | undefined) {
  return useQuery({
    queryKey: ['company', id],
    queryFn: ({ signal }) => api<CompanyDetail>(`/api/companies/${id}`, { signal }),
    enabled: Boolean(id),
    staleTime: 30_000,
  });
}

export function useCompanies(params: CompaniesParams = {}) {
  return useQuery({
    queryKey: ['companies', params],
    queryFn: ({ signal }) => {
      const usp = new URLSearchParams();
      if (params.search) usp.set('search', params.search);
      if (params.industry) usp.set('industry', params.industry);
      if (params.cursor) usp.set('cursor', params.cursor);
      const path = `/api/companies${usp.toString() ? `?${usp.toString()}` : ''}`;
      return api<CompaniesPayload>(path, { signal });
    },
  });
}

export function useCreateCompany() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CompanyCreate) =>
      api<Company>('/api/companies', { method: 'POST', body: input }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['companies'] }),
  });
}

export function useUpdateCompany() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: CompanyPatch }) =>
      api<Company>(`/api/companies/${id}`, { method: 'PATCH', body: patch }),
    onSuccess: (_data, variables) => {
      void qc.invalidateQueries({ queryKey: ['companies'] });
      void qc.invalidateQueries({ queryKey: ['company', variables.id] });
    },
  });
}

export function useDeleteCompany() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<null>(`/api/companies/${id}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['companies'] }),
  });
}

export function useCompanyHierarchy(id: string | undefined) {
  return useQuery({
    queryKey: ['company-hierarchy', id],
    queryFn: ({ signal }) => api<CompanyHierarchy>(`/api/companies/${id}/hierarchy`, { signal }),
    enabled: Boolean(id),
    staleTime: 30_000,
  });
}
