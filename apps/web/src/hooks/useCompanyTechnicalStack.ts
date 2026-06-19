import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';

import type {
  TechnicalStackCategory,
  TechnicalStackRefreshResponse,
  TechnicalStackState,
} from '@bidstack/shared';

const technicalStackQueryKey = (companyKey: string | undefined) => [
  'crm-company-technical-stack',
  companyKey ?? '',
];

function technicalStackPath(companyKey: string): string {
  return `/api/crm/companies/${encodeURIComponent(companyKey)}/technical-stack`;
}

function invalidateAccountData(queryClient: ReturnType<typeof useQueryClient>, companyKey: string): void {
  void queryClient.invalidateQueries({ queryKey: technicalStackQueryKey(companyKey) });
  void queryClient.invalidateQueries({ queryKey: ['crm-dashboard'] });
}

export function useCompanyTechnicalStack(companyKey: string | undefined) {
  return useQuery({
    queryKey: technicalStackQueryKey(companyKey),
    queryFn: ({ signal }) => api<TechnicalStackState>(technicalStackPath(companyKey!), { signal }),
    enabled: Boolean(companyKey),
    staleTime: 0,
  });
}

export function useSaveCompanyTechnicalStack(companyKey: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (stack: TechnicalStackCategory[]) =>
      api<TechnicalStackState>(technicalStackPath(companyKey), {
        method: 'PUT',
        body: { stack },
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(technicalStackQueryKey(companyKey), data);
      invalidateAccountData(queryClient, companyKey);
    },
  });
}

export function useRefreshCompanyTechnicalStack(companyKey: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api<TechnicalStackRefreshResponse>(`${technicalStackPath(companyKey)}/refresh`, {
        method: 'POST',
        body: {},
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(technicalStackQueryKey(companyKey), data.state);
      invalidateAccountData(queryClient, companyKey);
    },
  });
}

export function useAcceptTechnicalStackSuggestion(companyKey: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (suggestionId: string) =>
      api<TechnicalStackState>(
        `${technicalStackPath(companyKey)}/suggestions/${encodeURIComponent(suggestionId)}/accept`,
        { method: 'POST' },
      ),
    onSuccess: (data) => {
      queryClient.setQueryData(technicalStackQueryKey(companyKey), data);
      invalidateAccountData(queryClient, companyKey);
    },
  });
}

export function useDismissTechnicalStackSuggestion(companyKey: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (suggestionId: string) =>
      api<TechnicalStackState>(
        `${technicalStackPath(companyKey)}/suggestions/${encodeURIComponent(suggestionId)}/dismiss`,
        { method: 'POST' },
      ),
    onSuccess: (data) => {
      queryClient.setQueryData(technicalStackQueryKey(companyKey), data);
      invalidateAccountData(queryClient, companyKey);
    },
  });
}
