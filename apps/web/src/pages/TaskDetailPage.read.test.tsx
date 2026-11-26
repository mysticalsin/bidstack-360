// A paused or in-flight task read has no payload and isLoading false.
// That must not look like a deleted task, a failed load, or a task
// that already arrived.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Task, TaskPage } from '@bidstack/shared';

const taskQuery = vi.hoisted(() => ({
  current: {
    data: undefined as TaskPage | null | undefined,
    isLoading: false,
    isError: false,
    status: 'pending' as string,
    error: null as Error | null,
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string, vars?: Record<string, unknown>) => {
      const text = fallback ?? key;
      if (!vars) return text;
      return text.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(vars[name] ?? ''));
    },
  }),
}));

vi.mock('react-router-dom', () => ({
  useParams: () => ({ id: '22222222-2222-4222-8222-222222222222' }),
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));

vi.mock('@/hooks/useTasks', () => ({
  useTasks: () => taskQuery.current,
  useUpdateTask: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('@/hooks/useCapabilities', () => ({
  useHasPermission: () => true,
}));

vi.mock('@/components/CustomFieldValuesSection', () => ({
  CustomFieldValuesSection: () => null,
}));

import { TaskDetailPage } from './TaskDetailPage';

const CHECKING = 'Checking this task. It has not arrived.';
const FAILED = 'Failed to load task';
const MISSING = 'Task not found';
const DELETED = 'This task may have been deleted.';
const TITLE = 'Northwind printer follow-up';
const TASK_ID = '22222222-2222-4222-8222-222222222222';

function task(title: string): Task {
  return {
    id: TASK_ID,
    oppId: null,
    title,
    dueDate: null,
    status: 'open',
    assignee: null,
    createdAt: '2026-11-05T15:00:00.000Z',
  };
}

function page(items: Task[]): TaskPage {
  return { items, nextCursor: null };
}

function unread(status: string, isLoading = false) {
  taskQuery.current = {
    data: undefined,
    isLoading,
    isError: false,
    status,
    error: null,
  };
}

function renderTask() {
  return render(<TaskDetailPage />);
}

describe('task detail read', () => {
  afterEach(() => {
    cleanup();
    unread('pending');
  });

  it('does not treat a paused task as missing', () => {
    unread('idle', false);
    renderTask();
    expect(screen.getByRole('status').textContent).toContain(CHECKING);
    expect(screen.queryByText(MISSING)).toBeNull();
    expect(screen.queryByText(DELETED)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText(TITLE)).toBeNull();
  });

  it('does not treat an in-flight task as missing when isLoading is false', () => {
    unread('pending', false);
    renderTask();
    expect(screen.getByRole('status').textContent).toContain(CHECKING);
    expect(screen.queryByText(MISSING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText(TITLE)).toBeNull();
  });

  it('does not treat an in-flight task as only a skeleton', () => {
    unread('pending', true);
    renderTask();
    expect(screen.getByRole('status').textContent).toContain(CHECKING);
    expect(screen.queryByText(MISSING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText(TITLE)).toBeNull();
  });

  it('keeps a failed task on the error when isError is true', () => {
    taskQuery.current = {
      data: undefined,
      isLoading: false,
      isError: true,
      status: 'error',
      error: new Error('tasks down'),
    };
    renderTask();
    expect(screen.getByRole('alert').textContent).toContain(FAILED);
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(MISSING)).toBeNull();
    expect(screen.queryByText(TITLE)).toBeNull();
  });

  it('drops a stale task when isError is true', () => {
    taskQuery.current = {
      data: page([task(TITLE)]),
      isLoading: false,
      isError: true,
      status: 'error',
      error: new Error('tasks down'),
    };
    renderTask();
    expect(screen.getByRole('alert').textContent).toContain(FAILED);
    expect(screen.queryByText(TITLE)).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(MISSING)).toBeNull();
  });

  it('drops a stale task when the status is error and isError is still false', () => {
    taskQuery.current = {
      data: page([task(TITLE)]),
      isLoading: false,
      isError: false,
      status: 'error',
      error: null,
    };
    renderTask();
    expect(screen.getByRole('alert').textContent).toContain(FAILED);
    expect(screen.queryByText(TITLE)).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
  });

  it('treats a settled null payload as a missing task', () => {
    taskQuery.current = {
      data: null,
      isLoading: false,
      isError: false,
      status: 'success',
      error: null,
    };
    renderTask();
    expect(screen.getByText(MISSING)).toBeTruthy();
    expect(screen.getByText(DELETED)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('stays missing when a settled list does not contain the task', () => {
    taskQuery.current = {
      data: page([]),
      isLoading: false,
      isError: false,
      status: 'success',
      error: null,
    };
    renderTask();
    expect(screen.getByText(MISSING)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(TITLE)).toBeNull();
  });

  it('still shows a task that arrived', () => {
    taskQuery.current = {
      data: page([task(TITLE)]),
      isLoading: false,
      isError: false,
      status: 'success',
      error: null,
    };
    renderTask();
    expect(screen.getByRole('heading', { name: TITLE })).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(MISSING)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('still shows a task when the title is blank', () => {
    taskQuery.current = {
      data: page([task('')]),
      isLoading: false,
      isError: false,
      status: 'success',
      error: null,
    };
    renderTask();
    expect(screen.getByRole('heading').textContent).toBe('');
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(MISSING)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
