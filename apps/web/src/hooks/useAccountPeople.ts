import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import type {
  AccountWork,
  ContactFactCreate,
  CustomerCommitmentCreate,
  CustomerCommitmentRow,
  FactDecisionBody,
  PeopleMap,
  PersonFact,
} from '@bidstack/shared';

export function usePeopleMap(scope: { companyId?: string; opportunityId?: string }) {
  const key = scope.opportunityId
    ? ['people-map', 'opportunity', scope.opportunityId]
    : ['people-map', 'company', scope.companyId];
  return useQuery({
    queryKey: key,
    enabled: Boolean(scope.companyId || scope.opportunityId),
    queryFn: ({ signal }) => {
      const path = scope.opportunityId
        ? `/api/opportunities/${scope.opportunityId}/people-map`
        : `/api/companies/${scope.companyId}/people-map`;
      return api<PeopleMap>(path, { signal });
    },
  });
}

export function useAccountWork(scope: { companyId?: string; opportunityId?: string }) {
  const key = scope.opportunityId
    ? ['commitments', 'opportunity', scope.opportunityId]
    : ['commitments', 'company', scope.companyId];
  return useQuery({
    queryKey: key,
    enabled: Boolean(scope.companyId || scope.opportunityId),
    queryFn: ({ signal }) => {
      const path = scope.opportunityId
        ? `/api/opportunities/${scope.opportunityId}/commitments`
        : `/api/companies/${scope.companyId}/commitments`;
      return api<AccountWork>(path, { signal });
    },
  });
}

function invalidatePeople(qc: ReturnType<typeof useQueryClient>) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: ['people-map'] }),
    qc.invalidateQueries({ queryKey: ['commitments'] }),
  ]);
}

export function useCreatePersonFact(contactId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ContactFactCreate) =>
      api<PersonFact>(`/api/contacts/${contactId}/facts`, { method: 'POST', body }),
    onSuccess: () => invalidatePeople(qc),
  });
}

export function useDecidePersonFact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { factId: string; body: FactDecisionBody }) =>
      api<PersonFact>(`/api/contact-facts/${input.factId}/decision`, {
        method: 'POST',
        body: input.body,
      }),
    onSuccess: () => invalidatePeople(qc),
  });
}

export function useCreateCommitment(scope: { companyId?: string; opportunityId?: string }) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CustomerCommitmentCreate) => {
      const path = scope.opportunityId
        ? `/api/opportunities/${scope.opportunityId}/commitments`
        : `/api/companies/${scope.companyId}/commitments`;
      return api<CustomerCommitmentRow>(path, { method: 'POST', body });
    },
    onSuccess: () => invalidatePeople(qc),
  });
}
