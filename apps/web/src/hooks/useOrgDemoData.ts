import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import type { OrgDemoDataSettings } from '@bidstack/shared';

const KEY = ['org-settings', 'demo-data'] as const;

export function useOrgDemoData() {
  return useQuery({
    queryKey: KEY,
    queryFn: ({ signal }) => api<OrgDemoDataSettings>('/api/org-settings/demo-data', { signal }),
    staleTime: 0,
    refetchOnMount: 'always',
  });
}

export function useUpdateOrgDemoData() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (demoData: boolean) =>
      api<OrgDemoDataSettings>('/api/org-settings/demo-data', { method: 'PUT', body: { demoData } }),
    onSuccess: (data) => {
      queryClient.setQueryData(KEY, data);
    },
  });
}
