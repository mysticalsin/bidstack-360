// The demo book files the Stellantis handover as done two days ago and the
// IKEA pricing annex as still open three days out. Due date used the due
// day alone, so the finished handover led the list and looked like the
// next deadline. Due date has to put the open annex first.
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

vi.mock('@/hooks/useCapabilities', () => ({ useHasPermission: vi.fn(() => true) }));

vi.mock('@/hooks/useOpportunities', () => ({
  useOpportunities: vi.fn(() => ({ data: { items: [] }, isLoading: false })),
}));

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

function task(partial: Pick<Task, 'id' | 'title' | 'dueDate' | 'status'>): Task {
  return {
    oppId: null,
    assignee: null,
    createdAt: '2026-11-20T00:00:00.000Z',
    ...partial,
  };
}

// Server due-day order: the finished handover is earliest, then the open work.
const DEMO_DUE_ORDER: Task[] = [
  task({
    id: 'task-stellantis',
    title: 'Stellantis handover',
    dueDate: '2026-11-23',
    status: 'done',
  }),
  task({
    id: 'task-ikea',
    title: 'IKEA pricing annex',
    dueDate: '2026-11-28',
    status: 'open',
  }),
  task({
    id: 'task-hsbc',
    title: 'HSBC questionnaire',
    dueDate: '2026-11-29',
    status: 'in_progress',
  }),
  task({
    id: 'task-siemens',
    title: 'Siemens technical volume',
    dueDate: '2026-11-30',
    status: 'in_progress',
  }),
  task({
    id: 'task-sanofi',
    title: 'Sanofi workshop',
    dueDate: '2026-12-02',
    status: 'open',
  }),
];

function titles() {
  return screen.getAllByRole('link').map((el) => el.textContent);
}

function renderPage(search = '') {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/tasks${search}`]}>
        <TasksPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('TasksPage due date sort', () => {
  beforeEach(() => {
    vi.mocked(useTasks).mockReturnValue({
      data: { items: DEMO_DUE_ORDER, nextCursor: null },
      isLoading: false,
      isError: false,
      error: null,
    } as ReturnType<typeof useTasks>);
  });

  afterEach(() => {
    cleanup();
  });

  it('puts the open IKEA annex ahead of the finished Stellantis handover', () => {
    renderPage('?sort=due');

    const order = titles();
    expect(order.indexOf('IKEA pricing annex')).toBe(0);
    expect(order.indexOf('IKEA pricing annex')).toBeLessThan(order.indexOf('Stellantis handover'));
    expect(order.indexOf('Stellantis handover')).toBe(order.length - 1);
  });

  it('leaves Recent on the loaded order, so the handover can still lead that view', () => {
    renderPage();

    expect(titles()[0]).toBe('Stellantis handover');
  });
});
