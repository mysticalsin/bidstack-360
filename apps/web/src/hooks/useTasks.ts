import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import type { Task } from '@bidstack/shared';

export function useTasks() {
  return useQuery({
    queryKey: ['tasks'],
    queryFn: ({ signal }) => api<{ items: Task[] }>('/api/tasks', { signal }),
  });
}
