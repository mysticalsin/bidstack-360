import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';

export interface CapabilityManifest {
  userId: string;
  orgId: string;
  legacyRole: string;
  roles: string[];
  permissions: string[];
  isAdmin: boolean;
}

const CAPABILITIES_KEY = ['me', 'capabilities'] as const;

/**
 * The signed-in user's effective authorization, resolved server-side from their
 * role grants. Prefer gating UI on a specific permission via useHasPermission
 * over the binary useIsAdmin() so the product reflects the real RBAC model.
 */
export function useCapabilities() {
  return useQuery({
    queryKey: CAPABILITIES_KEY,
    queryFn: ({ signal }) => api<CapabilityManifest>('/api/me/capabilities', { signal }),
    // Authorization rarely changes within a session; cache generously but allow
    // a manual refetch after a role assignment.
    staleTime: 5 * 60_000,
  });
}

/**
 * Returns whether the signed-in user holds a given permission key (e.g.
 * 'opportunities:write'). Admins implicitly pass. While the manifest is loading
 * this returns false, so callers should treat undefined access as "not yet
 * authorized" rather than flashing privileged UI.
 */
export function useHasPermission(key: string): boolean {
  const { data } = useCapabilities();
  if (!data) return false;
  return data.isAdmin || data.permissions.includes(key);
}
