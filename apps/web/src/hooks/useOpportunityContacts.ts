import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { toast } from '@/components/ui/Toast';
import type {
  OpportunityContact,
  OpportunityContactCreate,
  OpportunityContactPatch,
} from '@bidstack/shared';

type Payload = { items: OpportunityContact[] };

export function useOpportunityContacts(opportunityId: string | undefined) {
  return useQuery({
    queryKey: ['opportunity-contacts', opportunityId],
    queryFn: ({ signal }) =>
      api<Payload>(`/api/opportunities/${opportunityId}/contacts`, { signal }),
    enabled: Boolean(opportunityId),
  });
}

export function useLinkContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      opportunityId,
      body,
    }: {
      opportunityId: string;
      body: OpportunityContactCreate;
    }) =>
      api<OpportunityContact>(`/api/opportunities/${opportunityId}/contacts`, {
        method: 'POST',
        body,
      }),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ['opportunity-contacts', vars.opportunityId] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Could not link contact'),
  });
}

export function useUnlinkContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ opportunityId, contactId }: { opportunityId: string; contactId: string }) =>
      api<null>(`/api/opportunities/${opportunityId}/contacts/${contactId}`, { method: 'DELETE' }),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ['opportunity-contacts', vars.opportunityId] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Could not unlink contact'),
  });
}

export function useUpdateContactRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      opportunityId,
      contactId,
      patch,
    }: {
      opportunityId: string;
      contactId: string;
      patch: OpportunityContactPatch;
    }) =>
      api<OpportunityContact>(`/api/opportunities/${opportunityId}/contacts/${contactId}`, {
        method: 'PATCH',
        body: patch,
      }),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ['opportunity-contacts', vars.opportunityId] });
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : 'Could not update contact role'),
  });
}
