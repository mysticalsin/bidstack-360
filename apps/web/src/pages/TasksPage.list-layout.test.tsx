// A task row narrated itself: "Due May 12, 2026" plus "Overdue: 193d late"
// and a warning glyph, on a second line under the title. Measured on the
// seeded list at 1280px, that second line was 673px wide and every row was
// 60px tall, so the list read as sentences instead of notes.
//
// The date is the date. Overdue, today, and later stay distinguishable
// without that sentence. These cases are the ones a bid list actually hits:
// an empty page, a single follow-up, a full page, a title long enough to
// ellipsize in the 975px row, and the three date states.
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { TasksPage } from './TasksPage';
import { useTasks } from '@/hooks/useTasks';
import { formatDate } from '@/lib/format';

import type { Task, TaskStatus } from '@bidstack/shared';

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

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

function mockTasks(items: Task[]) {
  vi.mocked(useTasks).mockReturnValue({
    data: { items, nextCursor: null },
    isLoading: false,
    isError: false,
    error: null,
  } as ReturnType<typeof useTasks>);
}

function renderPage() {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/tasks']}>
        <div style={{ width: 1280 }}>
          <TasksPage />
        </div>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const NOW = new Date('2026-11-20T12:00:00.000Z').getTime();

function task(over: Partial<Task> & Pick<Task, 'id' | 'title' | 'dueDate' | 'status'>): Task {
  return {
    oppId: null,
    assignee: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

const OVERDUE = task({
  id: 'overdue',
  title: 'Submit revised pricing',
  dueDate: '2026-11-01',
  status: 'open',
});
const TODAY = task({
  id: 'today',
  title: 'Call the buyer',
  dueDate: '2026-11-20',
  status: 'in_progress',
});
const FUTURE = task({
  id: 'future',
  title: 'Workshop with Logistec CISO',
  dueDate: '2026-12-15',
  status: 'open',
});
const UNDATED = task({
  id: 'undated',
  title: 'Untitled follow-up',
  dueDate: null,
  status: 'blocked',
});
const DONE = task({
  id: 'done',
  title: 'Filed the packet',
  dueDate: '2026-11-01',
  status: 'done' satisfies TaskStatus,
});
const LONG = task({
  id: 'long',
  title:
    'Confirm the MAPFRE budget owner and send the revised statement of work before the commercial review with Rush University procurement',
  dueDate: '2026-12-01',
  status: 'open',
});

function dueOf(title: string) {
  const link = screen.getByRole('link', { name: title });
  const row = link.closest('[role="listitem"]');
  if (!row) throw new Error(`no row for ${title}`);
  return within(row as HTMLElement).getByTestId('task-due');
}

describe('Tasks list — one date, no due sentence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capabilitiesMocks.useHasPermission.mockReturnValue(true);
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('shows the empty state and no due line when there are no tasks', () => {
    mockTasks([]);
    renderPage();

    expect(screen.getByText('Nothing on the bid clock')).toBeTruthy();
    expect(screen.queryAllByTestId('task-due')).toHaveLength(0);
    expect(screen.queryByText(/Overdue:/)).toBeNull();
    expect(screen.queryByRole('img', { name: 'warning' })).toBeNull();
  });

  it('shows one task as a title and a single date, with snooze and status still available', () => {
    mockTasks([FUTURE]);
    renderPage();

    expect(screen.getByRole('link', { name: FUTURE.title })).toBeTruthy();
    const due = dueOf(FUTURE.title);
    expect(due.textContent).toBe(formatDate(FUTURE.dueDate));
    expect(due.getAttribute('data-urgency')).toBe('future');
    expect(due.querySelector('[data-testid="task-due-mark"]')).toBeNull();
    expect(screen.queryByText(/Due /)).toBeNull();
    expect(screen.queryByText(/\bin \d+d\b/)).toBeNull();
    expect(screen.getByRole('button', { name: /Snooze Workshop with Logistec CISO/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Status: open/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeTruthy();
  });

  it('keeps every title on a full page, including a long one, at a 1280px frame', () => {
    mockTasks([OVERDUE, TODAY, FUTURE, UNDATED, DONE, LONG]);
    const { container } = renderPage();

    // The page is mounted in a 1280px frame, the width where the live row
    // measured 975px. happy-dom does not run flex layout, so this pins the
    // classes that keep a long title on one line inside that row: truncate
    // on the link, a real flex-basis on the title column, and the date as
    // its own shrink-wrapped sibling rather than a paragraph under the title.
    expect(container.firstElementChild?.getAttribute('style')).toContain('width: 1280px');

    for (const item of [OVERDUE, TODAY, FUTURE, UNDATED, DONE, LONG]) {
      const link = screen.getByRole('link', { name: item.title });
      expect(link.className).toContain('truncate');
      expect(link.className).toContain('block');
      const titleColumn = link.parentElement;
      expect(titleColumn?.className).toContain('basis-');
      expect(titleColumn?.className).toContain('min-w-0');
      const due = dueOf(item.title);
      expect(titleColumn?.contains(due)).toBe(false);
    }

    expect(screen.getAllByTestId('task-due')).toHaveLength(6);
    expect(screen.queryByText(/Overdue:/)).toBeNull();
    expect(screen.queryByText(/\bin \d+d\b/)).toBeNull();
    expect(screen.queryByRole('img', { name: 'warning' })).toBeNull();
  });

  it('marks an overdue date without the late sentence', () => {
    mockTasks([OVERDUE]);
    renderPage();

    const due = dueOf(OVERDUE.title);
    expect(due.textContent).toBe(formatDate(OVERDUE.dueDate));
    expect(due.getAttribute('data-urgency')).toBe('overdue');
    expect(due.getAttribute('aria-label')).toBe(`${formatDate(OVERDUE.dueDate)}, overdue`);
    expect(due.className).toContain('text-[var(--danger)]');
    const mark = due.querySelector('[data-testid="task-due-mark"]');
    expect(mark).toBeTruthy();
    expect(mark?.getAttribute('data-mark')).toBe('filled');
    expect(screen.queryByText(/Overdue:/)).toBeNull();
    expect(screen.queryByText(/late/)).toBeNull();
  });

  it('marks a task due today without an "in 0d" caption', () => {
    mockTasks([TODAY]);
    renderPage();

    const due = dueOf(TODAY.title);
    expect(due.textContent).toBe(formatDate(TODAY.dueDate));
    expect(due.getAttribute('data-urgency')).toBe('today');
    expect(due.getAttribute('aria-label')).toBe(`${formatDate(TODAY.dueDate)}, due today`);
    expect(due.className).toContain('text-[var(--warning)]');
    expect(due.querySelector('[data-testid="task-due-mark"]')?.getAttribute('data-mark')).toBe(
      'outline',
    );
    expect(screen.queryByText(/\bin 0d\b/)).toBeNull();
  });

  it('leaves a future date, a finished task, and a missing date as plain dates', () => {
    mockTasks([FUTURE, DONE, UNDATED]);
    renderPage();

    const future = dueOf(FUTURE.title);
    expect(future.getAttribute('data-urgency')).toBe('future');
    expect(future.textContent).toBe(formatDate(FUTURE.dueDate));
    expect(future.className).toContain('text-[var(--fg-tertiary)]');
    expect(future.querySelector('[data-testid="task-due-mark"]')).toBeNull();

    const done = dueOf(DONE.title);
    expect(done.getAttribute('data-urgency')).toBe('done');
    expect(done.textContent).toBe(formatDate(DONE.dueDate));
    expect(done.className).not.toContain('text-[var(--danger)]');
    expect(done.querySelector('[data-testid="task-due-mark"]')).toBeNull();
    expect(screen.getByRole('link', { name: DONE.title }).parentElement?.className).toContain(
      'line-through',
    );

    const undated = dueOf(UNDATED.title);
    expect(undated.getAttribute('data-urgency')).toBe('none');
    expect(undated.textContent).toBe('—');
    expect(undated.getAttribute('aria-label')).toBe('No due date');
    expect(undated.querySelector('[data-testid="task-due-mark"]')).toBeNull();
  });
});
