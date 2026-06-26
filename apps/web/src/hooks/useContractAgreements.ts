import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import type {
  ContractAgreement,
  ContractAgreementCreate,
  ContractExtractionApproval,
  ContractAgreementPage,
  ContractAgreementPatch,
  ContractExtractionResult,
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

export function useApproveContractExtraction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: ContractExtractionApproval }) =>
      api<ContractAgreement>(`/api/contract-agreements/extractions/${id}/approve`, {
        method: 'POST',
        body,
      }),
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

// Queue an OCR/extraction job for an uploaded contract document.
export function useExtractContract() {
  return useMutation({
    mutationFn: (fileId: string) =>
      api<ContractExtractionResult>('/api/contract-agreements/extract', {
        method: 'POST',
        body: { fileId },
      }),
  });
}

// Poll an extraction until it reaches a terminal state (done | error).
export function useContractExtraction(id: string | null) {
  return useQuery({
    queryKey: ['contract-extraction', id],
    queryFn: ({ signal }) =>
      api<ContractExtractionResult>(`/api/contract-agreements/extractions/${id}`, { signal }),
    enabled: id !== null,
    refetchInterval: (query) => {
      const s = query.state.data?.status;
      return s === 'done' || s === 'error' ? false : 2000;
    },
  });
}
