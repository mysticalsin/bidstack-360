import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';

export type IntakeAccessManifest = {
  isAdmin: boolean;
  permissions: string[];
};

// Same cache key as useCapabilities. The dropzone does not import that hook:
// some page tests replace the module with useHasPermission only.
export function useIntakeAccess() {
  return useQuery({
    queryKey: ['me', 'capabilities'],
    queryFn: ({ signal }) => api<IntakeAccessManifest>('/api/me/capabilities', { signal }),
    staleTime: 5 * 60_000,
  });
}
