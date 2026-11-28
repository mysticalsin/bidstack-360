// Regression: every task write route (POST/PATCH /api/tasks) is gated
// server-side behind tasks:write, but the page rendered the "New task"
// CTA, the inline quick-add form, and every row's status-cycle/snooze
// controls unconditionally — a user without the permission saw a fully
// editable page that 403'd on every click.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { TasksPage } from './TasksPage';
import { useTasks } from '@/hooks/useTasks';
import type { Task } from '@bidstack/shared';

// Real react-i18next isn't initialized under vitest, so t() returns the raw
// default string with unsubstituted {{vars}} — interpolate manually so
// aria-label assertions below (which target substituted text like
// "Status: open") match what a real user sees.
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
// Default to full access so an unrelated future test in this file isn't
// silently affected by another test's override; gating tests below flip
// this per-case.
vi.mock('@/hooks/useCapabilities', () => capabilitiesMocks);

// CreateTaskDialog pulls the opportunity list for its linked-opp select —
// stub it out so mounting the (permission-gated) dialog trigger doesn't
// depend on a live network response.
vi.mock('@/hooks/useOpportunities', () => ({
  useOpportunities: vi.fn(() => ({ data: { items: [] }, isLoading: false })),
}));

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

function mockTasks(value: Partial<ReturnType<typeof useTasks>>) {
  vi.mocked(useTasks).mockReturnValue(value as ReturnType<typeof useTasks>);
}

function renderPage(path = '/tasks') {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <TasksPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const TASK: Task = {
  id: 't-1',
  oppId: null,
  title: 'Send proposal',
  dueDate: '2026-12-01',
  status: 'open',
  assignee: null,
  createdAt: '2026-01-01T00:00:00.000Z',
};

describe('TasksPage — tasks:write gating', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capabilitiesMocks.useHasPermission.mockReturnValue(true);
    mockTasks({
      data: { items: [TASK], nextCursor: null },
      isLoading: false,
      isError: false,
      error: null,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('shows the New task CTA, inline quick-add, and enabled row actions for a user with tasks:write', () => {
    capabilitiesMocks.useHasPermission.mockReturnValue(true);

    renderPage();

    expect(screen.getByRole('button', { name: /New task/i })).toBeTruthy();
    expect(screen.getByLabelText('Quick-add task title')).toBeTruthy();

    const statusButton = screen.getByRole('button', { name: /Status: open/i });
    expect((statusButton as HTMLButtonElement).disabled).toBe(false);

    const snoozeButton = screen.getByRole('button', { name: /Snooze Send proposal/i });
    expect((snoozeButton as HTMLButtonElement).disabled).toBe(false);
  });

  it('hides the New task CTA and inline quick-add, and disables row actions for a user without tasks:write', () => {
    capabilitiesMocks.useHasPermission.mockReturnValue(false);

    renderPage();

    // Read access stays intact — the task itself still renders.
    expect(screen.getByText('Send proposal')).toBeTruthy();

    // Primary CTAs (create affordances) are hidden entirely, not disabled.
    expect(screen.queryByRole('button', { name: /New task/i })).toBeNull();
    expect(screen.queryByLabelText('Quick-add task title')).toBeNull();

    // Per-row write actions stay visible but disabled with a hint, so the
    // control's existence doesn't itself leak into a 403 on click.
    const statusButton = screen.getByRole('button', { name: /Status: open/i });
    expect((statusButton as HTMLButtonElement).disabled).toBe(true);
    expect(statusButton.getAttribute('title')).toBe(
      'You need task write access to edit this task.',
    );

    const snoozeButton = screen.getByRole('button', { name: /Snooze Send proposal/i });
    expect((snoozeButton as HTMLButtonElement).disabled).toBe(true);
    expect(snoozeButton.getAttribute('title')).toBe(
      'You need task write access to edit this task.',
    );
  });
});

// Needs you counts overdue follow-ups with due_date < today's UTC date. The
// list that link opens must use the same day: a follow-up due today is still
// today's work at 18:00 UTC, and one due yesterday is the late one.
describe('TasksPage — due today is not overdue', () => {
  const today: Task = {
    ...TASK,
    id: 'due-today',
    title: 'Call the buyer today',
    dueDate: '2026-11-25',
  };
  const yesterday: Task = {
    ...TASK,
    id: 'due-yesterday',
    title: 'Send the pricing note',
    dueDate: '2026-11-24',
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-25T18:00:00.000Z'));
    vi.clearAllMocks();
    capabilitiesMocks.useHasPermission.mockReturnValue(true);
    mockTasks({
      data: { items: [today, yesterday], nextCursor: null },
      isLoading: false,
      isError: false,
      error: null,
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('leaves a follow-up due today off the overdue list the dashboard opens', () => {
    renderPage('/tasks?filter=overdue');

    expect(screen.getByText('Send the pricing note')).toBeTruthy();
    expect(screen.queryByText('Call the buyer today')).toBeNull();
    expect(screen.getByText(/Overdue: 1d late/)).toBeTruthy();
  });

  it('keeps the due-today follow-up on the today list, not marked late', () => {
    renderPage('/tasks?filter=today');

    expect(screen.getByText('Call the buyer today')).toBeTruthy();
    expect(screen.queryByText('Send the pricing note')).toBeNull();
    expect(screen.getByText('in 0d')).toBeTruthy();
    expect(screen.queryByText(/Overdue:/)).toBeNull();
  });
});
