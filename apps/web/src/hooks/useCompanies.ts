import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { toast } from '@/components/ui/Toast';

import { api } from '@/lib/api';
import type { Company, CompanyCreate, CompanyDetail, CompanyPatch, CompanyHierarchy } from '@bidstack/shared';

interface CompaniesParams {
  search?: string;
  industry?: string;
  cursor?: string;
}

type CompaniesPayload = { items: Company[]; nextCursor?: string };

// A company create/update/tier change must refresh every account surface that
// derives from it — the list, key/top accounts, and the CRM dashboard/cockpit.
function invalidateAccountSurfaces(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: ['companies'] });
  void qc.invalidateQueries({ queryKey: ['key-accounts'] });
  void qc.invalidateQueries({ queryKey: ['top-accounts'] });
  void qc.invalidateQueries({ queryKey: ['crm-dashboard'] });
}

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
    // Live: reflect edits/designations immediately, not the global 2-min cache.
    staleTime: 0,
    refetchOnMount: 'always',
  });
}

export function useCreateCompany() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CompanyCreate) =>
      api<Company>('/api/companies', { method: 'POST', body: input }),
    onSuccess: () => invalidateAccountSurfaces(qc),
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : 'Could not create company'),
  });
}

export function useUpdateCompany() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: CompanyPatch }) =>
      api<Company>(`/api/companies/${id}`, { method: 'PATCH', body: patch }),
    onSuccess: (_data, variables) => {
      invalidateAccountSurfaces(qc);
      void qc.invalidateQueries({ queryKey: ['company', variables.id] });
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : 'Could not update company'),
  });
}

export function useDeleteCompany() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<null>(`/api/companies/${id}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['companies'] }),
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : 'Could not delete company'),
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
