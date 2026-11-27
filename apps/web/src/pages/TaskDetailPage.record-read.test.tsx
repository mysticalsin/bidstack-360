// A paused follow-up read has no record yet. The detail page used the same
// "Task not found" line as a settled miss, which tells the reader the
// follow-up was deleted. The payload has not arrived.
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TaskDetailPage } from './TaskDetailPage';
import { useTasks, useUpdateTask } from '@/hooks/useTasks';
import type { Task } from '@bidstack/shared';

const TASK_ID = '00000000-0000-4000-8000-000000010001';
const NOT_FOUND = 'Task not found';
const DELETED = 'This task may have been deleted.';
const CHECKING = 'Checking this follow-up. The follow-up has not arrived.';
const LOAD_ERROR = 'Failed to load task';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, opts?: Record<string, unknown>) => {
      if (!opts) return fallback;
      return Object.entries(opts).reduce(
        (str, [k, v]) => str.replace(`{{${k}}}`, String(v)),
        fallback,
      );
    },
  }),
}));

vi.mock('react-router-dom', () => ({
  useParams: () => ({ id: TASK_ID }),
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));

vi.mock('@/hooks/useTasks', () => ({
  useTasks: vi.fn(),
  useUpdateTask: vi.fn(),
}));

vi.mock('@/hooks/useCapabilities', () => ({
  useHasPermission: vi.fn(() => true),
}));

vi.mock('@/components/ui/Toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/components/CustomFieldValuesSection', () => ({
  CustomFieldValuesSection: () => null,
}));

const TASK: Task = {
  id: TASK_ID,
  oppId: null,
  title: 'Submit revised pricing and SoW v2',
  dueDate: '2026-05-15',
  status: 'open',
  assignee: 'alex.example@example.test',
  createdAt: '2026-05-01T00:00:00.000Z',
};

function mockTasks(value: Record<string, unknown>) {
  vi.mocked(useTasks).mockReturnValue(value as ReturnType<typeof useTasks>);
  vi.mocked(useUpdateTask).mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
  } as unknown as ReturnType<typeof useUpdateTask>);
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <TaskDetailPage />
    </QueryClientProvider>,
  );
}

describe('TaskDetailPage record read', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('does not call a paused follow-up read a deleted task', () => {
    // A pause reports isLoading false and no list. The page treated that as a miss.
    mockTasks({
      data: undefined,
      isLoading: false,
      isPending: true,
      isError: false,
      error: null,
      status: 'pending',
      fetchStatus: 'paused',
    });

    renderPage();

    expect(screen.queryByRole('heading', { name: NOT_FOUND })).toBeNull();
    expect(screen.queryByText(DELETED)).toBeNull();
    expect(screen.getByText(CHECKING)).toBeTruthy();
  });

  it('does not leave an in-flight follow-up read as a silent skeleton', () => {
    mockTasks({
      data: undefined,
      isLoading: true,
      isPending: true,
      isError: false,
      error: null,
      status: 'pending',
      fetchStatus: 'fetching',
    });

    renderPage();

    expect(screen.queryByRole('heading', { name: NOT_FOUND })).toBeNull();
    expect(screen.queryByText(DELETED)).toBeNull();
    expect(screen.getByText(CHECKING)).toBeTruthy();
  });

  it('keeps a failed follow-up read on the error, not on not-found', () => {
    mockTasks({
      data: undefined,
      isLoading: false,
      isPending: false,
      isError: true,
      error: new Error('The tasks read failed'),
      status: 'error',
      fetchStatus: 'idle',
    });

    renderPage();

    expect(screen.getByRole('heading', { name: LOAD_ERROR })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: NOT_FOUND })).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
  });

  it('still says the follow-up is missing after a settled list that does not hold it', () => {
    mockTasks({
      data: { items: [], nextCursor: null },
      isLoading: false,
      isPending: false,
      isError: false,
      error: null,
      status: 'success',
      fetchStatus: 'idle',
    });

    renderPage();

    expect(screen.getByRole('heading', { name: NOT_FOUND })).toBeTruthy();
    expect(screen.getByText(DELETED)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
  });

  it('still shows the follow-up once the list payload has arrived', () => {
    mockTasks({
      data: { items: [TASK], nextCursor: null },
      isLoading: false,
      isPending: false,
      isError: false,
      error: null,
      status: 'success',
      fetchStatus: 'idle',
    });

    renderPage();

    expect(screen.getByRole('heading', { name: TASK.title })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: NOT_FOUND })).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
  });
});
