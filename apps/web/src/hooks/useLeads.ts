import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';

import { api } from '@/lib/api';
import type {
  LeadCreate,
  LeadDetail,
  LeadFilter,
  LeadPage,
  LeadPatch,
  OpportunityStage,
} from '@bidstack/shared';

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
      stage?: OpportunityStage;
    }) =>
      api<{ leadId: string; opportunityId: string; contactId: string }>(
        `/api/leads/${id}/convert`,
        {
          method: 'POST',
          body,
        },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [LEADS_KEY, id] });
      qc.invalidateQueries({ queryKey: [LEADS_KEY] });
      qc.invalidateQueries({ queryKey: ['opportunities'] });
      qc.invalidateQueries({ queryKey: ['contacts'] });
    },
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
