// A fresh demo books open follow-ups a few days out (IKEA in 3, Siemens in 5)
// and one finished handover already past. Today and Overdue then match
// nothing. The empty card said "No tasks match this filter", which reads as
// an empty book while those rows are still on All.
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
        (str, [k, v]) => str.replaceAll(`{{${k}}}`, String(v)),
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

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

function mockTasks(items: Task[]) {
  vi.mocked(useTasks).mockReturnValue({
    data: { items, nextCursor: null },
    isLoading: false,
    isError: false,
    error: null,
  } as ReturnType<typeof useTasks>);
}

function renderPage(path: string) {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <TasksPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const IKEA: Task = {
  id: '00000000-0000-4000-8000-000000010011',
  oppId: null,
  title: 'Prepare pricing annex for IKEA',
  dueDate: '2026-11-28',
  status: 'open',
  assignee: 'marco.bianchi.demo@bidstack-demo.dev',
  createdAt: '2026-11-25T09:00:00.000Z',
};

const SIEMENS: Task = {
  id: '00000000-0000-4000-8000-000000010012',
  oppId: null,
  title: 'Finalize technical volume for Siemens ERP',
  dueDate: '2026-11-30',
  status: 'in_progress',
  assignee: 'sofia.almeida.demo@bidstack-demo.dev',
  createdAt: '2026-11-25T09:00:00.000Z',
};

const HANDOVER: Task = {
  id: '00000000-0000-4000-8000-000000010013',
  oppId: null,
  title: 'Kickoff handover to delivery, Stellantis',
  dueDate: '2026-11-23',
  status: 'done',
  assignee: 'marco.bianchi.demo@bidstack-demo.dev',
  createdAt: '2026-11-20T09:00:00.000Z',
};

const FRESH_DEMO = [IKEA, SIEMENS, HANDOVER];

describe('TasksPage fresh demo date chip is not an empty book', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-25T10:00:00.000Z'));
    vi.clearAllMocks();
    capabilitiesMocks.useHasPermission.mockReturnValue(true);
    mockTasks(FRESH_DEMO);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('names the IKEA annex when Today matches nothing because the work is still ahead', () => {
    renderPage('/tasks?filter=today');

    expect(screen.getByRole('heading', { name: 'Nothing is due today' })).toBeTruthy();
    expect(
      screen.getByText('Next is Prepare pricing annex for IKEA, in 3 days.'),
    ).toBeTruthy();
    expect(screen.queryByText('No tasks match this filter')).toBeNull();
    expect(screen.queryByText('Nothing on the bid clock')).toBeNull();
    expect(screen.queryByText('Kickoff handover to delivery, Stellantis')).toBeNull();
  });

  it('says Overdue is clear and counts only the open follow-ups still ahead', () => {
    renderPage('/tasks?filter=overdue');

    expect(screen.getByRole('heading', { name: 'Nothing is overdue' })).toBeTruthy();
    expect(
      screen.getByText(
        '2 open follow-ups in this list are still ahead. Next is Prepare pricing annex for IKEA, in 3 days.',
      ),
    ).toBeTruthy();
    expect(screen.queryByText('No tasks match this filter')).toBeNull();
  });

  it('keeps the generic filter title when Today is empty because the follow-ups are already late', () => {
    // The late sentence belongs to the Today-empty follow-up. This card must
    // not claim the May pricing row is still ahead.
    mockTasks([
      {
        ...IKEA,
        title: 'Submit revised pricing & SoW v2',
        dueDate: '2026-05-15',
        status: 'in_progress',
      },
    ]);

    renderPage('/tasks?filter=today');

    expect(screen.getByRole('heading', { name: 'No tasks match this filter' })).toBeTruthy();
    expect(screen.queryByText('Nothing is due today')).toBeNull();
  });
});
