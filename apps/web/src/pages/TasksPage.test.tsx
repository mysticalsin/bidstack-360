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

const PRICING_OPP = '00000000-0000-4000-8000-000000020041';

// The demo follow-up "Submit revised pricing & SoW v2" does not name the bid.
// A seller scanning the overdue list cannot tell it is CI Financial's
// modernization, and nothing on the row opens that bid.
describe('TasksPage — a follow-up names its bid', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capabilitiesMocks.useHasPermission.mockReturnValue(true);
    mockTasks({
      data: {
        items: [
          {
            ...TASK,
            id: '00000000-0000-4000-8000-000000010001',
            oppId: PRICING_OPP,
            title: 'Submit revised pricing & SoW v2',
            dueDate: '2026-05-15',
            status: 'in_progress',
            opportunityName: 'CI Financial — IT Modernization & MSP',
          },
        ],
        nextCursor: null,
      },
      isLoading: false,
      isError: false,
      error: null,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('links the demo pricing follow-up to the CI Financial bid by name', () => {
    renderPage();

    const bid = screen.getByRole('link', { name: 'CI Financial — IT Modernization & MSP' });
    expect(bid.getAttribute('href')).toBe(`/opportunities/${PRICING_OPP}`);
    expect(screen.queryByRole('link', { name: 'Opportunity' })).toBeNull();
    // axe target-size on /tasks: the title link and this bid link stack. Each
    // needs a 24px box or the undersized pair fails the tasks route scan.
    expect(bid.className).toContain('min-h-6');
    expect(
      screen.getByRole('link', { name: 'Submit revised pricing & SoW v2' }).className,
    ).toContain('min-h-6');
  });
});

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
