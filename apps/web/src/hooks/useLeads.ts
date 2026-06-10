import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';

import { api } from '@/lib/api';
import type { LeadCreate, LeadDetail, LeadFilter, LeadPage, LeadPatch } from '@bidstack/shared';

const LEADS_KEY = 'leads';

export function useLeads(filter: Partial<LeadFilter> = {}) {
  return useQuery<LeadPage>({
    queryKey: [LEADS_KEY, filter],
    queryFn: ({ signal }) => {
      const params = new URLSearchParams();
      if (filter.status) params.set('status', filter.status);
      if (filter.priority) params.set('priority', filter.priority);
      if (filter.source) params.set('source', filter.source);
      if (filter.ownerId) params.set('ownerId', filter.ownerId);
      if (filter.search) params.set('search', filter.search);
      if (filter.cursor) params.set('cursor', filter.cursor);
      if (filter.limit) params.set('limit', String(filter.limit));
      const path = `/api/leads${params.toString() ? `?${params.toString()}` : ''}`;
      return api<LeadPage>(path, { signal });
    },
  });
}

export function useLead(id: string) {
  return useQuery<LeadDetail>({
    queryKey: [LEADS_KEY, id],
    queryFn: ({ signal }) => api<LeadDetail>(`/api/leads/${id}`, { signal }),
    enabled: Boolean(id),
  });
}

export function useCreateLead() {
  const qc = useQueryClient();
  const nav = useNavigate();
  return useMutation({
    mutationFn: (body: LeadCreate) => api<LeadDetail>('/api/leads', { method: 'POST', body }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: [LEADS_KEY] });
      nav(`/leads/${data.id}`);
    },
  });
}

export function useUpdateLead(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: LeadPatch) => api<LeadDetail>(`/api/leads/${id}`, { method: 'PATCH', body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [LEADS_KEY, id] });
      qc.invalidateQueries({ queryKey: [LEADS_KEY] });
    },
  });
}

export function useConvertLead(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      opportunityName?: string;
      opportunityValueMicros?: number;
      pipelineStageId?: string;
      stage?: string;
    }) =>
      api<{ leadId: string; opportunityId: string; contactId: string }>(
        `/api/leads/${id}/convert`,
        {
          method: 'POST',
          body,
        },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [LEADS_KEY, id] });
      void qc.invalidateQueries({ queryKey: [LEADS_KEY] });
      void qc.invalidateQueries({ queryKey: ['opportunities'] });
      void qc.invalidateQueries({ queryKey: ['contacts'] });
      // P1 #10: count badge, dashboard, and pipeline report must reflect the new opportunity
      void qc.invalidateQueries({ queryKey: ['opportunities', 'count'] });
      void qc.invalidateQueries({ queryKey: ['crm-dashboard'] });
      void qc.invalidateQueries({ queryKey: ['report:pipeline'] });
    },
  });
}

// A2 (Twenty pattern) — variable-id variant for inline cell edits in the
// leads list. Unlike useUpdateLead(id), this receives {id, patch} per call
// so a single hook instance serves the whole table without mounting N mutations.
export function useUpdateLeadById() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: LeadPatch }) =>
      api<LeadDetail>(`/api/leads/${id}`, { method: 'PATCH', body: patch }),
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: [LEADS_KEY] });
      const snapshots: Array<readonly [readonly unknown[], LeadPage | LeadDetail | undefined]> = [];
      qc.getQueriesData<LeadPage | LeadDetail>({ queryKey: [LEADS_KEY] }).forEach(([key, value]) => {
        snapshots.push([key, value]);
        if (!value) return;
        if ('items' in value && Array.isArray(value.items)) {
          qc.setQueryData<LeadPage>(key, {
            ...value,
            items: value.items.map((l) => (l.id === id ? { ...l, ...patch } : l)),
          });
        } else if ('id' in value && value.id === id) {
          qc.setQueryData<LeadDetail>(key, { ...value, ...patch } as LeadDetail);
        }
      });
      return { snapshots };
    },
    onError: (_err, _vars, ctx) => {
      ctx?.snapshots.forEach(([key, value]) => qc.setQueryData(key, value));
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: [LEADS_KEY] }),
  });
}

export function useDeleteLead() {
  const qc = useQueryClient();
  const nav = useNavigate();
  return useMutation({
    mutationFn: (leadId: string) => api(`/api/leads/${leadId}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [LEADS_KEY] });
      nav('/leads');
    },
  });
}
