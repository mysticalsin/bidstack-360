// Recent is the default tasks order. An unread or failed read has no rows
// yet. The header, the status line, and the calendar must not use the empty
// book sentence for that miss. A payload that arrived empty still may.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { TasksPage } from './TasksPage';
import { useTasks } from '@/hooks/useTasks';
import type { Task } from '@bidstack/shared';

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

vi.mock('@/hooks/useTasks', () => ({
  useTasks: vi.fn(),
  useCreateTask: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useUpdateTask: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}));

vi.mock('@/hooks/useCapabilities', () => ({
  useHasPermission: vi.fn(() => true),
}));

vi.mock('@/hooks/useOpportunities', () => ({
  useOpportunities: vi.fn(() => ({ data: { items: [] }, isLoading: false })),
}));

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

function mockTasks(value: Partial<ReturnType<typeof useTasks>>) {
  vi.mocked(useTasks).mockReturnValue(value as ReturnType<typeof useTasks>);
}

function renderAt(path: string) {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <TasksPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const TASK: Task = {
  id: '00000000-0000-4000-8000-000000010001',
  oppId: null,
  title: 'Submit revised pricing and SoW v2',
  dueDate: '2026-05-15',
  status: 'open',
  assignee: 'alex.example@example.com',
  createdAt: '2026-05-08T00:00:00.000Z',
};

describe('TasksPage recent read honesty', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('does not call an unread Recent list empty or zero', () => {
    // The default sort is Recent. A paused read has not delivered rows.
    // isLoading is false in that pause, so the empty book used to render.
    mockTasks({
      data: undefined,
      isLoading: false,
      isPending: true,
      isError: false,
      error: null,
    });

    renderAt('/tasks');

    expect(screen.getByRole('combobox', { name: 'Sort tasks' }).textContent).toContain('Recent');
    expect(screen.getAllByText('Checking recent follow-ups.').length).toBeGreaterThan(0);
    expect(screen.queryByText('Nothing on the bid clock')).toBeNull();
    expect(screen.queryByText('No tasks match this filter')).toBeNull();
    expect(screen.queryByText('0 active follow-ups.')).toBeNull();
    expect(screen.queryByText('0 task')).toBeNull();
    expect((screen.getByRole('button', { name: 'Export CSV' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('does not call a failed Recent read zero', () => {
    // The error card already says the load failed. The status line still
    // counted zero, which is the sentence for a book with no follow-ups.
    mockTasks({
      data: undefined,
      isLoading: false,
      isPending: false,
      isError: true,
      error: new Error('The tasks read failed'),
    });

    renderAt('/tasks');

    expect(screen.getByText('Could not load tasks')).toBeTruthy();
    expect(
      screen.getAllByText('Could not load recent follow-ups. They have not arrived.').length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText('Nothing on the bid clock')).toBeNull();
    expect(screen.queryByText('0 active follow-ups.')).toBeNull();
    expect(screen.queryByText('0 task')).toBeNull();
    expect((screen.getByRole('button', { name: 'Export CSV' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('does not draw a blank Recent month when the read has not arrived', () => {
    // Calendar view used the missing payload as an empty month, so every
    // day looked free.
    mockTasks({
      data: undefined,
      isLoading: false,
      isPending: true,
      isError: false,
      error: null,
    });

    renderAt('/tasks?view=calendar');

    expect(screen.getAllByText('Checking recent follow-ups.').length).toBeGreaterThan(0);
    expect(screen.queryByText('Sun')).toBeNull();
    expect(screen.queryByText('0 task')).toBeNull();
  });

  it('does not count zero while Recent is still loading', () => {
    // The first paint is isLoading. That used the same zero caption as an empty book.
    mockTasks({
      data: undefined,
      isLoading: true,
      isPending: true,
      isError: false,
      error: null,
    });

    renderAt('/tasks');

    expect(screen.getAllByText('Checking recent follow-ups.').length).toBeGreaterThan(0);
    expect(screen.queryByText('Nothing on the bid clock')).toBeNull();
    expect(screen.queryByText('0 active follow-ups.')).toBeNull();
    expect(screen.queryByText('0 task')).toBeNull();
  });

  it('keeps an arrived empty Recent book at zero', () => {
    mockTasks({
      data: { items: [], nextCursor: null },
      isLoading: false,
      isPending: false,
      isError: false,
      error: null,
    });

    renderAt('/tasks');

    expect(screen.getByText('Nothing on the bid clock')).toBeTruthy();
    expect(screen.getByText('0 active follow-ups.')).toBeTruthy();
    expect(screen.getByText('0 task')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Export CSV' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it('keeps a follow-up that has arrived on the Recent list', () => {
    mockTasks({
      data: { items: [TASK], nextCursor: null },
      isLoading: false,
      isPending: false,
      isError: false,
      error: null,
    });

    renderAt('/tasks');

    expect(screen.getByText('Submit revised pricing and SoW v2')).toBeTruthy();
    expect(screen.getByText('1 active follow-ups.')).toBeTruthy();
    expect(screen.queryByText('Checking recent follow-ups.')).toBeNull();
  });
});
