import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from '@/components/ui/Toast';

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

interface UsersPage {
  items: OrgUser[];
  nextCursor: string | null;
}

interface UsersPageParams {
  cursor?: string;
  /** Route caps at 200; default 100 matches the API default. */
  limit?: number;
  enabled?: boolean;
}

function usersPath(params: UsersPageParams): string {
  const qs = new URLSearchParams();
  if (params.cursor) qs.set('cursor', params.cursor);
  if (params.limit) qs.set('limit', String(params.limit));
  return `/api/users${qs.toString() ? `?${qs.toString()}` : ''}`;
}

// useUsers — the flat-list view every picker/count consumer relies on.
// GET /api/users is cursor-paginated and returns { items, nextCursor }; we
// unwrap to OrgUser[] via `select` so callers keep using `users.data` as an
// array (passing the raw object to `.map()` crashed the Forecasts page).
//
// LIMITATION: the /api/users route exposes no `search` param, so the owner /
// assignee pickers that consume this hook cannot do a server-side typeahead and
// still load a single bounded page. We raise their limit to the route maximum
// (200) so they no longer silently cap at the first 100, but a true 100k-tenant
// fix needs a backend `?search=` endpoint. See useUsersPage for the paginated
// Team list view.
export function useUsers(params: UsersPageParams = {}) {
  const { enabled = true, ...queryParams } = params;
  return useQuery({
    queryKey: ['users', queryParams],
    queryFn: ({ signal }) => api<UsersPage>(usersPath(queryParams), { signal }),
    enabled,
    select: (data) => data.items,
  });
}

// useUsersPage — the cursor-paginated view for the admin Team list, which must
// page through every member at a large tenant instead of capping at 100.
// Returns the raw { items, nextCursor } so the page can drive a CursorPager.
export function useUsersPage(params: UsersPageParams = {}) {
  const { enabled = true, ...queryParams } = params;
  return useQuery<UsersPage>({
    queryKey: ['users', 'page', queryParams],
    queryFn: ({ signal }) => api<UsersPage>(usersPath(queryParams), { signal }),
    enabled,
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
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : 'Could not update user role'),
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
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Could not assign role'),
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
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Could not revoke role'),
  });
}
