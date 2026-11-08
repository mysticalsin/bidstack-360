// Per-org data residency tag. `region: null` means the org is not pinned and
// uses the deployment's default storage.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import type { OrgDataResidency, OrgDataResidencyView } from '@bidstack/shared';

const KEY = ['org-settings', 'data-residency'] as const;

export function useDataResidency() {
  return useQuery({
    queryKey: KEY,
    queryFn: ({ signal }) =>
      api<OrgDataResidencyView>('/api/org-settings/data-residency', { signal }),
    staleTime: 0,
    refetchOnMount: 'always',
  });
}

export function useUpdateDataResidency() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: OrgDataResidency) =>
      api<OrgDataResidencyView>('/api/org-settings/data-residency', { method: 'PUT', body }),
    onSuccess: (data) => {
      queryClient.setQueryData(KEY, data);
    },
  });
}
