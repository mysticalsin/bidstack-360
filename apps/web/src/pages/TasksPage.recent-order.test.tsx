// The demo book loads in due-day order. The finished Stellantis handover
// (23 Nov 2026) is first and the open IKEA annex (28 Nov) is second. Recent
// is the default, so the list opens on a follow-up that is already done.
import { cleanup, render, screen, within } from '@testing-library/react';
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

const capabilitiesMocks = vi.hoisted(() => ({ useHasPermission: vi.fn(() => true) }));
vi.mock('@/hooks/useCapabilities', () => capabilitiesMocks);

vi.mock('@/hooks/useOpportunities', () => ({
  useOpportunities: vi.fn(() => ({ data: { items: [] }, isLoading: false })),
}));

const HANDOVER: Task = {
  id: '00000000-0000-4000-8000-000000010005',
  oppId: '00000000-0000-4000-8000-000000020005',
  title: 'Kickoff handover to delivery, Stellantis',
  dueDate: '2026-11-23',
  status: 'done',
  assignee: 'marco.example@example.test',
  createdAt: '2026-11-20T00:00:00.000Z',
};

const IKEA: Task = {
  id: '00000000-0000-4000-8000-000000010002',
  oppId: '00000000-0000-4000-8000-000000020002',
  title: 'Prepare pricing annex for IKEA',
  dueDate: '2026-11-28',
  status: 'open',
  assignee: 'marco.example@example.test',
  createdAt: '2026-11-18T00:00:00.000Z',
};

const HSBC: Task = {
  id: '00000000-0000-4000-8000-000000010004',
  oppId: '00000000-0000-4000-8000-000000020004',
  title: 'Security questionnaire response, HSBC',
  dueDate: '2026-11-29',
  status: 'in_progress',
  assignee: 'sofia.example@example.test',
  createdAt: '2026-11-18T00:00:00.000Z',
};

const SIEMENS: Task = {
  id: '00000000-0000-4000-8000-000000010001',
  oppId: '00000000-0000-4000-8000-000000020001',
  title: 'Finalize technical volume for Siemens ERP',
  dueDate: '2026-11-30',
  status: 'in_progress',
  assignee: 'sofia.example@example.test',
  createdAt: '2026-11-18T00:00:00.000Z',
};

const SANOFI: Task = {
  id: '00000000-0000-4000-8000-000000010003',
  oppId: '00000000-0000-4000-8000-000000020003',
  title: 'Schedule discovery workshop with Sanofi CMIO',
  dueDate: '2026-12-02',
  status: 'open',
  assignee: 'priya.example@example.test',
  createdAt: '2026-11-18T00:00:00.000Z',
};

// Route order: earliest due day first. The finished handover leads.
const LOADED = [HANDOVER, IKEA, HSBC, SIEMENS, SANOFI];

function mockTasks() {
  vi.mocked(useTasks).mockReturnValue({
    data: { items: LOADED, nextCursor: null },
    isLoading: false,
    isError: false,
    error: null,
  } as ReturnType<typeof useTasks>);
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <TasksPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function titles(): string[] {
  const list = screen.getByRole('list');
  return within(list)
    .getAllByRole('link')
    .map((link) => link.textContent ?? '');
}

describe('TasksPage recent order', () => {
  beforeEach(() => {
    localStorage.clear();
    useTaskOrder.setState({ order: {} });
    vi.clearAllMocks();
    capabilitiesMocks.useHasPermission.mockReturnValue(true);
    mockTasks();
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    useTaskOrder.setState({ order: {} });
  });

  it('does not open the demo list on the finished Stellantis handover', () => {
    renderPage();

    expect(titles()).toEqual([
      IKEA.title,
      HSBC.title,
      SIEMENS.title,
      SANOFI.title,
      HANDOVER.title,
    ]);
  });

  it('keeps a dragged handover at the top of Recent', () => {
    // WHY: a personal order is the user's list. Sinking finished rows must
    // not undo a drag that put the handover first.
    useTaskOrder.getState().setOrder(LOADED.map((task) => task.id));

    renderPage();

    expect(titles()[0]).toBe(HANDOVER.title);
  });
});
