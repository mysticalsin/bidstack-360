import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';

import type {
  AccountIntelSnapshot,
  DocumentExtraction,
  ExtractDocumentRequest,
} from '@bidstack/shared';

export function useAccountIntel(
  accountId: string | undefined,
  opts?: { refetchInterval?: number | false },
) {
  return useQuery({
    enabled: !!accountId,
    queryKey: ['account-intel', accountId],
    queryFn: ({ signal }) =>
      api<AccountIntelSnapshot>(`/api/accounts/${accountId}/intel`, { signal }),
    staleTime: 30_000,
    refetchInterval: opts?.refetchInterval,
  });
}

export function useExtractDocument(accountId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ documentId, body }: { documentId: string; body?: ExtractDocumentRequest }) => {
      if (!accountId) throw new Error('Account ID required');
      return api<DocumentExtraction>(`/api/accounts/${accountId}/documents/${documentId}/extract`, {
        method: 'POST',
        body: body ?? {},
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['account-intel', accountId] });
    },
  });
}

export function useDeleteSolution(accountId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (solutionId: string) => {
      if (!accountId) throw new Error('Account ID required');
      return api(`/api/accounts/${accountId}/solutions/${solutionId}`, { method: 'DELETE' });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['account-intel', accountId] });
    },
  });
}

export function useDeleteProduct(accountId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (productId: string) => {
      if (!accountId) throw new Error('Account ID required');
      return api(`/api/accounts/${accountId}/products/${productId}`, { method: 'DELETE' });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['account-intel', accountId] });
    },
  });
}
