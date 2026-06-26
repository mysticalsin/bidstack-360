import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import type { Task, TaskCreate, TaskFilter, TaskPage, TaskPatch } from '@bidstack/shared';

type TasksPayload = TaskPage;
type TaskSummaryPayload = { total: number; open: number; overdue: number; dueSoon: number };

// Cursor-paginated like the other operational lists. /api/tasks defaults to
// limit 50; calling useTasks() with no filter loads the first page only — the
// page-level consumer (TasksPage) threads cursor/limit via CursorPager so the
// admin Tasks screen is no longer capped at the first 50 at a large tenant.
export function useTasks(filter: Partial<TaskFilter> = {}) {
  return useQuery<TaskPage>({
    queryKey: ['tasks', filter],
    queryFn: ({ signal }) => {
      const params = new URLSearchParams();
      if (filter.status) params.set('status', filter.status);
      if (filter.oppId) params.set('oppId', filter.oppId);
      if (filter.cursor) params.set('cursor', filter.cursor);
      if (filter.limit) params.set('limit', String(filter.limit));
      const path = `/api/tasks${params.toString() ? `?${params.toString()}` : ''}`;
      return api<TaskPage>(path, { signal });
    },
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
      // P1 #30: creating a task also affects dashboard activity counters
      void qc.invalidateQueries({ queryKey: ['crm-dashboard'] });
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
      // The task list is cursor-paginated, so its cache key is ['tasks', filter]
      // — there can be several entries (per filter/cursor). Patch every list
      // entry that holds the task; getQueriesData also surfaces ['tasks',
      // 'summary'], so the `Array.isArray(items)` guard skips that sibling.
      const snapshot = qc.getQueriesData<TasksPayload>({ queryKey: ['tasks'] });
      const { customFieldValues: _cf, ...rest } = patch as Record<string, unknown>;
      for (const [key, data] of snapshot) {
        if (!data || !Array.isArray(data.items)) continue;
        qc.setQueryData<TasksPayload>(key, {
          ...data,
          items: data.items.map((t) => (t.id === id ? { ...t, ...rest } : t)),
        });
      }
      return { snapshot };
    },
    onError: (_err, _vars, ctx) => {
      if (!ctx?.snapshot) return;
      for (const [key, data] of ctx.snapshot) {
        if (data === undefined) continue;
        qc.setQueryData(key, data);
      }
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['tasks'] });
      void qc.invalidateQueries({ queryKey: ['tasks', 'summary'] });
      void qc.invalidateQueries({ queryKey: ['opportunity'] });
      // P2 #30: task completion affects dashboard activity counters
      void qc.invalidateQueries({ queryKey: ['crm-dashboard'] });
    },
  });
}
