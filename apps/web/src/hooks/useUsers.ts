import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

interface OrgUser {
  id: string;
  name: string | null;
  email: string;
  role: string;
  createdAt: string;
}

// PresenceEntry mirrors the server-side shape from presence.service.ts.
// We only need userId here — the rest is used by richer presence UIs.
interface PresenceEntry {
  userId: string;
  name: string;
  avatarUrl: string | null;
  currentEntityType: string | null;
  currentEntityId: string | null;
  sessionId: string;
  lastSeenAt: number;
}

export function useUsers() {
  // GET /api/users is cursor-paginated and returns { items, nextCursor }.
  // Unwrap to the OrgUser[] array via `select` so every consumer (which all
  // use `users.data` as a flat list) keeps working — passing the raw object
  // to a `.map()` crashed the Forecasts page.
  return useQuery({
    queryKey: ['users'],
    queryFn: ({ signal }) =>
      api<{ items: OrgUser[]; nextCursor: string | null }>('/api/users', { signal }),
    select: (data) => data.items,
  });
}

// WHY /api/v1/presence/org: The presence route lives under /api/v1 (Wave 7
// real-time registration). Polls every 30s — matches the Redis 30s TTL so we
// see a departed user drop off within one cycle. Returns a Set<userId> for
// O(1) "is this user online?" lookups in the Team table.
export function useOrgPresence() {
  return useQuery({
    queryKey: ['presence', 'org'],
    queryFn: ({ signal }) => api<{ users: PresenceEntry[] }>('/api/v1/presence/org', { signal }),
    refetchInterval: 30_000,
    // Never treat stale presence data as an error — offline is fine.
    retry: false,
    select: (data): Set<string> => new Set(data.users.map((u) => u.userId)),
  });
}

export function useUpdateUserRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, role }: { id: string; role: 'member' | 'admin' }) =>
      api<OrgUser>(`/api/users/${id}/role`, {
        method: 'PATCH',
        body: { role },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
}

export interface AssignedRole {
  roleId: string;
  name: string;
  description: string | null;
  isSystem: boolean;
}

// Granular custom-role grants for a single user. Fetched lazily (per expanded
// row) so the Team table doesn't fire one request per member on load.
export function useUserRoles(userId: string | null, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ['user-roles', userId],
    queryFn: ({ signal }) =>
      api<{ items: AssignedRole[] }>(`/api/users/${userId}/roles`, { signal }),
    enabled: (options.enabled ?? true) && userId !== null,
    select: (data) => data.items,
  });
}

export function useAssignUserRole(userId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (roleId: string) =>
      api<{ items: AssignedRole[] }>(`/api/users/${userId}/roles`, {
        method: 'POST',
        body: { roleId },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['user-roles', userId] });
      // The actor's own effective permissions may have changed.
      qc.invalidateQueries({ queryKey: ['me', 'capabilities'] });
    },
  });
}

export function useRevokeUserRole(userId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (roleId: string) =>
      api<void>(`/api/users/${userId}/roles/${roleId}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['user-roles', userId] });
      qc.invalidateQueries({ queryKey: ['me', 'capabilities'] });
    },
  });
}
