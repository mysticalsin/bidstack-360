// The tasks route returns due-date order. The control still says Recent, so
// the Due date choice looks stuck: on the Polo book it does not move
// "Schedule Aritzia kickoff" (12 May 2026) off the top, even though the DNB
// workshop was filed later.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { TasksPage } from './TasksPage';
import { useTasks } from '@/hooks/useTasks';
import { useTaskOrder } from '@/stores/taskOrder';
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

function task(partial: Pick<Task, 'id' | 'title' | 'dueDate' | 'createdAt'>): Task {
  return {
    oppId: null,
    status: 'open',
    assignee: null,
    ...partial,
  };
}

// Payload order is the route order: earliest due day first.
const ARITZIA = task({
  id: '00000000-0000-4000-8000-000000010006',
  title: 'Schedule Aritzia kickoff',
  dueDate: '2026-05-12',
  createdAt: '2026-05-08T12:00:00.000Z',
});
const PRICING = task({
  id: '00000000-0000-4000-8000-000000010001',
  title: 'Submit revised pricing & SoW v2',
  dueDate: '2026-05-15',
  createdAt: '2026-05-01T12:00:00.000Z',
});
const WORKSHOP = task({
  id: '00000000-0000-4000-8000-000000010007',
  title: 'Architecture workshop, DNB',
  dueDate: '2026-05-19',
  createdAt: '2026-05-10T12:00:00.000Z',
});

function titles(): string[] {
  const list = screen.getByRole('list');
  return within(list)
    .getAllByRole('link')
    .map((link) => link.textContent ?? '');
}

function renderPage() {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/tasks']}>
        <TasksPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('TasksPage recent order is not the due-date order', () => {
  beforeEach(() => {
    useTaskOrder.setState({ order: {} });
    vi.mocked(useTasks).mockReturnValue({
      data: { items: [ARITZIA, PRICING, WORKSHOP], nextCursor: null },
      isLoading: false,
      isError: false,
      error: null,
    } as ReturnType<typeof useTasks>);
  });

  afterEach(() => {
    cleanup();
  });

  it('lists the latest filed follow-up first while the control says Recent', () => {
    renderPage();

    expect(screen.getByRole('combobox', { name: 'Sort tasks' }).textContent).toContain('Recent');
    // The workshop was filed on 10 May. Aritzia is only first because its due
    // day is 12 May. Recent must not keep that due-date order.
    expect(titles()[0]).toBe('Architecture workshop, DNB');
    expect(titles()).toEqual([
      'Architecture workshop, DNB',
      'Schedule Aritzia kickoff',
      'Submit revised pricing & SoW v2',
    ]);
  });

  it('moves the 12 May kickoff to the top when Due date is chosen', () => {
    renderPage();

    // Recent has to show the later filing first, or this click is a no-op
    // on the route's due-date payload.
    expect(titles()[0]).toBe('Architecture workshop, DNB');

    fireEvent.click(screen.getByRole('combobox', { name: 'Sort tasks' }));
    fireEvent.click(screen.getByRole('option', { name: 'Due date' }));

    expect(screen.getByRole('combobox', { name: 'Sort tasks' }).textContent).toContain('Due date');
    expect(titles()).toEqual([
      'Schedule Aritzia kickoff',
      'Submit revised pricing & SoW v2',
      'Architecture workshop, DNB',
    ]);
  });
});
