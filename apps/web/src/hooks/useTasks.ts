import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import type { Task, TaskCreate, TaskPatch } from '@bidstack/shared';

type TasksPayload = { items: Task[] };
type TaskSummaryPayload = { total: number; open: number; overdue: number; dueSoon: number };

export function useTasks() {
  return useQuery({
    queryKey: ['tasks'],
    queryFn: ({ signal }) => api<TasksPayload>('/api/tasks', { signal }),
  });
}

export function useTaskSummary() {
  return useQuery({
    queryKey: ['tasks', 'summary'],
    queryFn: ({ signal }) => api<TaskSummaryPayload>('/api/tasks/summary', { signal }),
    staleTime: 30_000,
  });
}

export function useCreateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: TaskCreate) => api<Task>('/api/tasks', { method: 'POST', body: input }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['tasks'] });
      void qc.invalidateQueries({ queryKey: ['tasks', 'summary'] });
      // Also invalidate the opportunity detail because /opportunities/:id
      // bundles tasks into the same payload — without this the new task
      // would appear in the Tasks page but not the opportunity tab.
      void qc.invalidateQueries({ queryKey: ['opportunity'] });
    },
  });
}

// Optimistic patch — status toggles (most common case) flip the badge tone
// the instant the user clicks, before the network confirms.
export function useUpdateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: TaskPatch }) =>
      api<Task>(`/api/tasks/${id}`, { method: 'PATCH', body: patch }),
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: ['tasks'] });
      const snapshot = qc.getQueryData<TasksPayload>(['tasks']);
      if (snapshot) {
        const { customFieldValues: _cf, ...rest } = patch as Record<string, unknown>;
        qc.setQueryData<TasksPayload>(['tasks'], {
          ...snapshot,
          items: snapshot.items.map((t) => (t.id === id ? { ...t, ...rest } : t)),
        });
      }
      return { snapshot };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.snapshot) qc.setQueryData(['tasks'], ctx.snapshot);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['tasks'] });
      void qc.invalidateQueries({ queryKey: ['tasks', 'summary'] });
      void qc.invalidateQueries({ queryKey: ['opportunity'] });
    },
  });
}
