import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { toast } from '@/components/ui/Toast';
import type { AppModules, AppModulesUpdate } from '@bidstack/shared';

const KEY = ['org-settings', 'app-modules'] as const;

/** Per-org module toggles (agent-studio visibility, AppFlowy Workspace). */
export function useAppModules() {
  return useQuery({
    queryKey: KEY,
    queryFn: ({ signal }) => api<AppModules>('/api/org-settings/app-modules', { signal }),
    staleTime: 60_000,
  });
}

export function useUpdateAppModules() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AppModulesUpdate) =>
      api<AppModules>('/api/org-settings/app-modules', { method: 'PUT', body }),
    onSuccess: (data) => {
      qc.setQueryData(KEY, data);
      toast.success('Modules updated');
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not update modules'),
  });
}
