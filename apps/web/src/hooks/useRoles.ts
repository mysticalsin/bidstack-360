import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface Permission {
  id: string;
  key: string;
  name: string;
  description: string | null;
}

export interface Role {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  createdAt: string;
  permissions: Permission[];
}

export function useRoles(options: { enabled?: boolean } = {}) {
  return useQuery<Role[]>({
    queryKey: ['roles'],
    queryFn: async () => {
      const data = await api<{ items: Role[] }>('/api/roles');
      return data.items;
    },
    enabled: options.enabled ?? true,
  });
}

export function usePermissions(options: { enabled?: boolean } = {}) {
  return useQuery<Permission[]>({
    queryKey: ['permissions'],
    queryFn: async () => {
      const data = await api<{ items: Permission[] }>('/api/permissions');
      return data.items;
    },
    enabled: options.enabled ?? true,
  });
}

export function useCreateRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { name: string; description?: string; permissionIds: string[] }) => {
      return api<Role>('/api/roles', { method: 'POST', body });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['roles'] }),
  });
}

export function useUpdateRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      ...body
    }: {
      id: string;
      name?: string;
      description?: string;
      permissionIds?: string[];
    }) => {
      return api<Role>(`/api/roles/${id}`, { method: 'PATCH', body });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['roles'] }),
  });
}

export function useDeleteRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      return api<void>(`/api/roles/${id}`, { method: 'DELETE' });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['roles'] }),
  });
}
