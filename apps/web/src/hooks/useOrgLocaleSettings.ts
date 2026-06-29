import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import type { OrgLocaleSettings, OrgLocaleSettingsUpdate } from '@bidstack/shared';

const KEY = ['org-settings', 'locale'] as const;

export function useOrgLocaleSettings() {
  return useQuery({
    queryKey: KEY,
    queryFn: ({ signal }) => api<OrgLocaleSettings>('/api/org-settings/locale', { signal }),
    staleTime: 0,
    refetchOnMount: 'always',
  });
}

export function useUpdateOrgLocaleSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: OrgLocaleSettingsUpdate) =>
      api<OrgLocaleSettings>('/api/org-settings/locale', { method: 'PUT', body }),
    onSuccess: (data) => {
      queryClient.setQueryData(KEY, data);
    },
  });
}
