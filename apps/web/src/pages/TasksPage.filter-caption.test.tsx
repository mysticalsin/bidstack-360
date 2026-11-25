// Demo follow-ups are dated May 2026. On 25 Nov 2026 the Today chip matches
// none of them, and the list is empty. The header still counted every loaded
// row as an active follow-up, so the empty view read as a full book. Overdue
// has the same split: a December row stays off that chip, and the header
// must not keep counting it.
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

const DECEMBER: Task = {
  id: '00000000-0000-4000-8000-000000010010',
  oppId: null,
  title: 'Send the December pack',
  dueDate: '2026-12-20',
  status: 'open',
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

describe('TasksPage filter caption', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    vi.clearAllMocks();
    capabilitiesMocks.useHasPermission.mockReturnValue(true);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('does not call the loaded book active when Today shows none of the May demo follow-ups', () => {
    mockTasks({
      data: { items: [PRICING], nextCursor: null },
      isLoading: false,
      isError: false,
      error: null,
    });

    renderPage('/tasks?filter=today');

    expect(screen.getByText('Nothing due today.')).toBeTruthy();
    expect(screen.queryByText('Submit revised pricing & SoW v2')).toBeNull();
    expect(screen.queryByText(/active follow-up/)).toBeNull();
  });

  it('counts only the rows the Overdue chip is showing', () => {
    mockTasks({
      data: { items: [PRICING, DECEMBER], nextCursor: null },
      isLoading: false,
      isError: false,
      error: null,
    });

    renderPage('/tasks?filter=overdue');

    expect(screen.getByText('1 overdue.')).toBeTruthy();
    expect(screen.getByText('Submit revised pricing & SoW v2')).toBeTruthy();
    expect(screen.queryByText('Send the December pack')).toBeNull();
    expect(screen.queryByText(/active follow-up/)).toBeNull();
  });

  it('says the Overdue chip is empty when every loaded follow-up is still ahead', () => {
    mockTasks({
      data: { items: [DECEMBER], nextCursor: null },
      isLoading: false,
      isError: false,
      error: null,
    });

    renderPage('/tasks?filter=overdue');

    expect(screen.getByText('Nothing overdue in this list.')).toBeTruthy();
    expect(screen.queryByText('Send the December pack')).toBeNull();
    expect(screen.queryByText(/active follow-up/)).toBeNull();
  });
});
