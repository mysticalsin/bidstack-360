// The tasks list caption counts every loaded row as an active follow-up.
// On the Polo book, "Submit revised pricing & SoW v2" is in progress and
// already late (due 15 May 2026). A finished handover on the same page is
// not active work. While the read is in flight the caption said "0 active
// follow-ups", which is the same sentence as an empty book. Marking the
// pricing follow-up done toasts success and still leaves it in that count.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { Toaster } from '@/components/ui/Toast';
import { TasksPage } from './TasksPage';
import { useTasks, useUpdateTask } from '@/hooks/useTasks';
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

const HANDOVER: Task = {
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

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <TasksPage />
        <Toaster />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('TasksPage active follow-up caption', () => {
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

  it('does not say the book is empty while the demo follow-ups are still loading', () => {
    mockTasks({ data: undefined, isLoading: true, isError: false, error: null });

    renderPage();

    expect(screen.queryByText(/0 active follow-up/)).toBeNull();
    expect(screen.queryByText('Submit revised pricing & SoW v2')).toBeNull();
  });

  it('does not say the book is empty when the read fails', () => {
    mockTasks({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error('down'),
    });

    renderPage();

    expect(screen.getByText('Could not load tasks')).toBeTruthy();
    expect(screen.queryByText(/0 active follow-up/)).toBeNull();
  });

  it('says zero when the loaded page has no follow-ups', () => {
    mockTasks({
      data: { items: [], nextCursor: null },
      isLoading: false,
      isError: false,
      error: null,
    });

    renderPage();

    expect(screen.getByText('0 active follow-ups.')).toBeTruthy();
    expect(screen.getByText('Nothing on the bid clock')).toBeTruthy();
  });

  it('leaves a finished handover out of the active count, and drops the pricing follow-up when it is marked done', () => {
    const items = [PRICING, HANDOVER];
    mockTasks({
      data: { items, nextCursor: null },
      isLoading: false,
      isError: false,
      error: null,
    });
    vi.mocked(useUpdateTask).mockReturnValue({
      mutate: vi.fn((_vars, opts?: { onSuccess?: () => void }) => {
        opts?.onSuccess?.();
      }),
      isPending: false,
    } as ReturnType<typeof useUpdateTask>);

    const view = renderPage();

    // Two loaded rows, one already finished. The caption must not call both active.
    expect(screen.getByText('1 active follow-up.')).toBeTruthy();
    expect(screen.queryByText('2 active follow-ups.')).toBeNull();
    expect(screen.getByText(/Overdue:/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Status: in progress/i }));

    expect(
      screen.getByText('Marked "Submit revised pricing & SoW v2" done'),
    ).toBeTruthy();

    mockTasks({
      data: { items: [{ ...PRICING, status: 'done' }, HANDOVER], nextCursor: null },
      isLoading: false,
      isError: false,
      error: null,
    });
    view.rerender(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <TasksPage />
          <Toaster />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    // The toast said the pricing follow-up is done. It is no longer active,
    // and the late chip belongs on an open follow-up only.
    expect(screen.getByText('0 active follow-ups.')).toBeTruthy();
    expect(screen.queryByText(/Overdue:/)).toBeNull();
  });
});
