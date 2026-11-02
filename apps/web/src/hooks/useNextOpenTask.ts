import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';

export interface NextOpenTask {
  id: string;
  title: string;
  dueDate: string | null;
  companyId: string;
}

export interface NextOpenTaskRead {
  task: NextOpenTask | null;
  complete: boolean;
}

/** Earliest open task for the accounts in the current view. */
export function useNextOpenTask(companyIds: readonly string[]) {
  return useQuery({
    queryKey: ['crm-next-open-task', companyIds],
    enabled: companyIds.length > 0,
    staleTime: 30_000,
    queryFn: ({ signal }) =>
      api<NextOpenTaskRead>('/api/crm/accounts/next-open-task', {
        method: 'POST',
        signal,
        body: { companyIds: [...companyIds] },
      }),
  });
}
