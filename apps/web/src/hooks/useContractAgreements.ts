import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import type {
  ContractAgreement,
  ContractAgreementCreate,
  ContractAgreementPage,
  ContractAgreementPatch,
} from '@bidstack/shared';

export function useContractAgreements(accountKey: string) {
  return useQuery({
    queryKey: ['contract-agreements', accountKey],
    queryFn: ({ signal }) =>
      api<ContractAgreementPage>(
        `/api/contract-agreements?accountKey=${encodeURIComponent(accountKey)}`,
        { signal },
      ),
    enabled: Boolean(accountKey),
    select: (data) => data.items,
  });
}

export function useCreateContractAgreement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ContractAgreementCreate) =>
      api<ContractAgreement>('/api/contract-agreements', { method: 'POST', body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['contract-agreements'] }),
  });
}

export function usePatchContractAgreement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: ContractAgreementPatch }) =>
      api<ContractAgreement>(`/api/contract-agreements/${id}`, { method: 'PATCH', body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['contract-agreements'] }),
  });
}

export function useDeleteContractAgreement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api(`/api/contract-agreements/${id}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['contract-agreements'] }),
  });
}
