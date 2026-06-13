// M7 — access groups (Settings → Access groups).
// Admin CRUD over /api/v1/user-groups; drives the server-side access
// scoping layer. Server invalidates its scope cache on every mutation,
// so the client only needs to refetch the groups queries.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type {
  UserGroup,
  UserGroupCreate,
  UserGroupPatch,
  UserGroupWithMembers,
} from '@bidstack/shared';

import { api } from '@/lib/api';

const KEY = ['user-groups'] as const;

export function useUserGroups() {
  return useQuery({
    queryKey: KEY,
    queryFn: ({ signal }) => api<{ items: UserGroup[] }>('/api/v1/user-groups', { signal }),
    select: (data) => data.items,
  });
}

export function useUserGroup(id: string | null) {
  return useQuery({
    queryKey: [...KEY, id],
    queryFn: ({ signal }) => api<UserGroupWithMembers>(`/api/v1/user-groups/${id}`, { signal }),
    enabled: id !== null,
  });
}

export function useCreateUserGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UserGroupCreate) =>
      api<UserGroup>('/api/v1/user-groups', { method: 'POST', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useUpdateUserGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UserGroupPatch }) =>
      api<UserGroup>(`/api/v1/user-groups/${id}`, { method: 'PATCH', body: patch }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useDeleteUserGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<null>(`/api/v1/user-groups/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useAddGroupMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ groupId, userId }: { groupId: string; userId: string }) =>
      api<{ ok: true }>(`/api/v1/user-groups/${groupId}/members`, {
        method: 'POST',
        body: { userId },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useRemoveGroupMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ groupId, userId }: { groupId: string; userId: string }) =>
      api<null>(`/api/v1/user-groups/${groupId}/members/${userId}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
