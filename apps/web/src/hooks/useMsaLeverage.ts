import { useQuery } from '@tanstack/react-query';

import { fetchLeverage, fetchLeverageSummary, fetchMsaLeverage, fetchValuePanel } from '@/lib/msa/intake';

export function useMsaLeverage(companyId?: string, enabled = true) {
  return useQuery({
    queryKey: ['msa', 'leverage', companyId ?? 'all'],
    queryFn: ({ signal }) => fetchLeverage(companyId, signal),
    enabled,
  });
}

export function useMsaLeverageSummary() {
  return useQuery({
    queryKey: ['msa', 'leverage', 'summary'],
    queryFn: ({ signal }) => fetchLeverageSummary(signal),
  });
}

export function useAgreementLeverage(id: string | undefined) {
  return useQuery({
    queryKey: ['msa', 'leverage', 'agreement', id],
    queryFn: ({ signal }) => fetchMsaLeverage(id!, signal),
    enabled: Boolean(id),
  });
}

export function useMsaValuePanel(id: string | undefined) {
  return useQuery({
    queryKey: ['msa', 'value-panel', id],
    queryFn: ({ signal }) => fetchValuePanel(id!, signal),
    enabled: Boolean(id),
  });
}
