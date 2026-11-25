// The demo book is seven May 2026 follow-ups. On 25 Nov 2026, Today matches
// none of them. The empty title "No tasks match this filter" does not say
// they are late, and the quick-add under it files an open follow-up that
// Today still will not show.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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

const capabilitiesMocks = vi.hoisted(() => ({ useHasPermission: vi.fn(() => true) }));
vi.mock('@/hooks/useCapabilities', () => capabilitiesMocks);

vi.mock('@/hooks/useOpportunities', () => ({
  useOpportunities: vi.fn(() => ({ data: { items: [] }, isLoading: false })),
}));

const NOW = new Date('2026-11-25T18:00:00.000Z');

const PRICING: Task = {
  id: '00000000-0000-4000-8000-000000010001',
  oppId: '00000000-0000-4000-8000-000000020041',
  title: 'Submit revised pricing & SoW v2',
  dueDate: '2026-05-15',
  status: 'in_progress',
  assignee: 'alex.example@example.test',
  createdAt: '2026-05-01T00:00:00.000Z',
};

const DONE: Task = {
  id: '00000000-0000-4000-8000-000000010099',
  oppId: null,
  title: 'Kickoff handover to delivery',
  dueDate: '2026-05-12',
  status: 'done',
  assignee: null,
  createdAt: '2026-05-01T00:00:00.000Z',
};

function mockTasks(value: Partial<ReturnType<typeof useTasks>>) {
  vi.mocked(useTasks).mockReturnValue(value as ReturnType<typeof useTasks>);
}

function renderPage(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <TasksPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('TasksPage — Today hides the late demo follow-ups', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.clearAllMocks();
    capabilitiesMocks.useHasPermission.mockReturnValue(true);
    mockTasks({
      data: { items: [PRICING, DONE], nextCursor: null },
      isLoading: false,
      isError: false,
      error: null,
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('says the May pricing follow-up is late and opens it from Show overdue', () => {
    renderPage('/tasks?filter=today');

    expect(screen.getByText('Nothing is due today')).toBeTruthy();
    expect(screen.getByText('Already late in this list: 1.')).toBeTruthy();
    expect(screen.queryByText('Submit revised pricing & SoW v2')).toBeNull();
    expect(screen.queryByLabelText('Quick-add task title')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Show overdue' }));

    expect(screen.getByText('Submit revised pricing & SoW v2')).toBeTruthy();
    expect(screen.queryByText('Kickoff handover to delivery')).toBeNull();
    expect(screen.queryByText('Nothing is due today')).toBeNull();
  });

  it('keeps the quick-add when the list is All', () => {
    renderPage('/tasks');

    expect(screen.getByLabelText('Quick-add task title')).toBeTruthy();
    expect(screen.queryByText('Nothing is due today')).toBeNull();
  });
});
