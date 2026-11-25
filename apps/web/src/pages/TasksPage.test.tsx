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

const summaryMocks = vi.hoisted(() => ({
  useTaskSummary: vi.fn(() => ({
    data: { total: 1, open: 1, overdue: 0, dueSoon: 0 },
    isLoading: false,
    isError: false,
  })),
}));

vi.mock('@/hooks/useTasks', () => ({
  useTasks: vi.fn(),
  useCreateTask: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useUpdateTask: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useTaskSummary: summaryMocks.useTaskSummary,
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

function renderPage() {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
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
    summaryMocks.useTaskSummary.mockReturnValue({
      data: { total: 1, open: 1, overdue: 0, dueSoon: 0 },
      isLoading: false,
      isError: false,
    });
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

// Demo book: four open follow-ups plus the completed Stellantis handover.
// The header must not count that done row, and it must not count only the
// page that happens to be loaded. While the summary is still out, "0 active"
// would read as an empty book.
describe('TasksPage — active follow-up count', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capabilitiesMocks.useHasPermission.mockReturnValue(true);
  });

  afterEach(() => {
    cleanup();
  });

  it('counts the book of open follow-ups, not the loaded page', () => {
    mockTasks({
      data: {
        items: [
          { ...TASK, id: 'ikea', title: 'Prepare pricing annex for IKEA', status: 'open' },
          {
            ...TASK,
            id: 'stellantis',
            title: 'Kickoff handover to delivery — Stellantis',
            status: 'done',
          },
        ],
        nextCursor: 'more',
      },
      isLoading: false,
      isError: false,
      error: null,
    });
    summaryMocks.useTaskSummary.mockReturnValue({
      data: { total: 5, open: 4, overdue: 0, dueSoon: 4 },
      isLoading: false,
      isError: false,
    });

    renderPage();

    expect(screen.getByText('4 active follow-ups.')).toBeTruthy();
    expect(screen.queryByText('2 active follow-ups.')).toBeNull();
    expect(screen.queryByText('5 active follow-ups.')).toBeNull();
  });

  it('does not call an unfinished count zero', () => {
    mockTasks({ data: undefined, isLoading: true, isError: false, error: null });
    summaryMocks.useTaskSummary.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    });

    renderPage();

    expect(screen.queryByText(/0 active follow-ups/)).toBeNull();
    expect(screen.getByText('Counting follow-ups.')).toBeTruthy();
  });

  it('says when the follow-up count did not load', () => {
    mockTasks({
      data: { items: [TASK], nextCursor: null },
      isLoading: false,
      isError: false,
      error: null,
    });
    summaryMocks.useTaskSummary.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    });

    renderPage();

    expect(screen.queryByText(/active follow-ups/)).toBeNull();
    expect(screen.getByText("Couldn't count follow-ups.")).toBeTruthy();
  });
});
