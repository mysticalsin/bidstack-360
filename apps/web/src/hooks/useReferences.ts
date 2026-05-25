import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface Reference {
  id: string;
  companyId: string | null;
  title: string;
  description: string | null;
  industry: string | null;
  valueMicros: string | null;
  contactName: string | null;
  contactEmail: string | null;
  usageCount: number;
  lastUsedAt: string | null;
  documentUrl: string | null;
  tags: string[];
  createdAt: string;
  company: { id: string; name: string; logoUrl: string | null } | null;
}

export function useReferences(filters?: {
  industry?: string;
  companyId?: string;
  tag?: string;
  search?: string;
}) {
  return useQuery<{ items: Reference[] }>({
    queryKey: ['references', filters],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters?.industry) params.set('industry', filters.industry);
      if (filters?.companyId) params.set('companyId', filters.companyId);
      if (filters?.tag) params.set('tag', filters.tag);
      if (filters?.search) params.set('search', filters.search);
      return api(`/api/references?${params.toString()}`);
    },
  });
}

export function useCreateReference() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: {
      companyId?: string;
      title: string;
      description?: string;
      industry?: string;
      valueMicros?: number;
      contactName?: string;
      contactEmail?: string;
      documentUrl?: string;
      tags?: string[];
    }) => api('/api/references', { method: 'POST', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['references'] }),
  });
}

export function useUpdateReference() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      ...body
    }: { id: string } & Partial<{
      title: string;
      description: string;
      industry: string;
      valueMicros: number;
      contactName: string;
      contactEmail: string;
      documentUrl: string;
      tags: string[];
    }>) => api(`/api/references/${id}`, { method: 'PATCH', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['references'] }),
  });
}

export function useDeleteReference() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => api(`/api/references/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['references'] }),
  });
}

export function useUseReference() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => api(`/api/references/${id}/use`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['references'] }),
  });
}
