import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import type { ProjectReference, ProjectReferenceList } from '@bidstack/shared';

export function useProjectReferences(accountKey: string) {
  return useQuery({
    queryKey: ['project-references', accountKey],
    queryFn: ({ signal }) =>
      api<ProjectReferenceList>(
        `/api/project-references?accountKey=${encodeURIComponent(accountKey)}`,
        { signal },
      ),
    enabled: accountKey.length > 0,
  });
}

export function useValidateProjectReference() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<ProjectReference>(`/api/project-references/${id}/validate`, { method: 'PATCH' }),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ['project-references'] }),
  });
}
