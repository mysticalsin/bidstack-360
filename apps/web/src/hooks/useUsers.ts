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
  return useQuery({
    queryKey: ['users'],
    queryFn: ({ signal }) => api<OrgUser[]>('/api/users', { signal }),
  });
}

// WHY /api/v1/presence/org: The presence route lives under /api/v1 (Wave 7
// real-time registration). Polls every 30s — matches the Redis 30s TTL so we
// see a departed user drop off within one cycle. Returns a Set<userId> for
// O(1) "is this user online?" lookups in the Team table.
export function useOrgPresence() {
  return useQuery({
    queryKey: ['presence', 'org'],
    queryFn: ({ signal }) =>
      api<{ users: PresenceEntry[] }>('/api/v1/presence/org', { signal }),
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
