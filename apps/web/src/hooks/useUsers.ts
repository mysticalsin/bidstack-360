import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

interface OrgUser {
  id: string;
  name: string | null;
  email: string;
  role: string;
  createdAt: string;
}

export function useUsers() {
  return useQuery({
    queryKey: ['users'],
    queryFn: ({ signal }) => api<OrgUser[]>('/api/users', { signal }),
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
