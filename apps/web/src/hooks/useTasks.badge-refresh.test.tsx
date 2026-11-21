// The nav badge reads ['tasks', 'summary']. Creating, completing, or deleting
// a task has to invalidate that query or the badge keeps the previous count
// while the Tasks page already shows the change.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '@/lib/api';

import { useCreateTask, useDeleteTask, useUpdateTask } from './useTasks';

vi.mock('@/lib/api', () => ({
  api: vi.fn(async () => ({ id: 'task-1', status: 'done' })),
}));

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { invalidate, wrapper };
}

describe('task badge refresh', () => {
  beforeEach(() => {
    vi.mocked(api).mockClear();
  });

  it('invalidates the summary when a task is created', async () => {
    const { invalidate, wrapper } = setup();
    const { result } = renderHook(() => useCreateTask(), { wrapper });
    await result.current.mutateAsync({
      oppId: null,
      title: 'Synthetic follow-up',
      dueDate: '2026-11-21',
      status: 'open',
      assignee: null,
    });
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['tasks', 'summary'] }),
    );
  });

  it('invalidates the summary when a task is completed', async () => {
    const { invalidate, wrapper } = setup();
    const { result } = renderHook(() => useUpdateTask(), { wrapper });
    await result.current.mutateAsync({ id: 'task-1', patch: { status: 'done' } });
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['tasks', 'summary'] }),
    );
  });

  it('invalidates the summary when a task is deleted', async () => {
    const { invalidate, wrapper } = setup();
    const { result } = renderHook(() => useDeleteTask(), { wrapper });
    await result.current.mutateAsync('task-1');
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['tasks', 'summary'] }),
    );
    expect(api).toHaveBeenCalledWith('/api/tasks/task-1', { method: 'DELETE' });
  });
});
