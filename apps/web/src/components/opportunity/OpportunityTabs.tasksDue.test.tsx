// Deal Tasks tab. Demo follow-ups are dated May 2026, so on a later day every
// open task is past due. The row used to print only "Due {date}", the same
// sentence as a task that is still ahead, and a failed read printed "No tasks
// yet". A bid owner reading this tab would treat a late follow-up as current
// and a CRM outage as an empty list.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Task } from '@bidstack/shared';

import { daysUntilDueUtc } from '@/components/ui/DueDateChip';

import { OpportunityTabs } from './OpportunityTabs';
import { OPPORTUNITY_TASK_PAGE_LIMIT } from './opportunity-task-caption';

const OPP_ID = '00000000-0000-4000-8000-0000000000aa';
const OTHER_OPP = '00000000-0000-4000-8000-0000000000bb';

const hookMocks = vi.hoisted(() => ({
  data: undefined as { items: Task[]; nextCursor: string | null } | undefined,
  isLoading: false,
  isError: false,
  refetch: vi.fn(),
}));

const useTasksMock = vi.hoisted(() => vi.fn(() => hookMocks));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, unknown>) => {
      if (!values) return fallback;
      return fallback.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => String(values[key] ?? ''));
    },
  }),
}));

vi.mock('@/lib/api', () => ({
  api: vi.fn().mockResolvedValue({ items: [] }),
}));

vi.mock('@/hooks/useTasks', () => ({
  useTasks: useTasksMock,
}));

function task(partial: Pick<Task, 'id' | 'title' | 'status' | 'dueDate'> & Partial<Task>): Task {
  return {
    oppId: OPP_ID,
    assignee: null,
    createdAt: '2026-05-01T00:00:00.000Z',
    ...partial,
  };
}

function renderTasks() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <OpportunityTabs oppId={OPP_ID} customer="Northwind Synthetic" />
    </QueryClientProvider>,
  );
  fireEvent.mouseDown(screen.getByRole('tab', { name: 'Tasks' }));
}

function rowText(title: string): string {
  const row = screen.getByText(title).closest('li');
  if (!row) throw new Error(`no task row for ${title}`);
  return row.textContent ?? '';
}

afterEach(() => {
  cleanup();
  hookMocks.data = undefined;
  hookMocks.isLoading = false;
  hookMocks.isError = false;
  hookMocks.refetch.mockClear();
  useTasksMock.mockClear();
});

describe('OpportunityTabs tasks — late follow-ups', () => {
  it('reads this deal only, one page', () => {
    // WHY: a tenant-wide task read would put another account's late follow-up
    // on this bid. The page size is the same cap the caption already explains.
    hookMocks.data = { items: [], nextCursor: null };
    renderTasks();
    expect(useTasksMock).toHaveBeenCalledWith({ oppId: OPP_ID, limit: OPPORTUNITY_TASK_PAGE_LIMIT });
  });

  it('says an open, in-progress, or blocked task is overdue once its date has passed', () => {
    // WHY: demo tasks due in May 2026 are months late on a later day. The
    // tasks list already says "Overdue". This tab must use that sentence and
    // the UTC day count, so "due today" is not late for the whole afternoon.
    const lateBy = Math.abs(daysUntilDueUtc('2020-01-01'));
    hookMocks.data = {
      nextCursor: null,
      items: [
        task({
          id: '00000000-0000-4000-8000-000000010001',
          title: 'Revise the schedule',
          status: 'in_progress',
          dueDate: '2020-01-01',
        }),
        task({
          id: '00000000-0000-4000-8000-000000010002',
          title: 'Send the agenda',
          status: 'open',
          dueDate: '2020-01-01',
        }),
        task({
          id: '00000000-0000-4000-8000-000000010003',
          title: 'Chase the signature',
          status: 'blocked',
          dueDate: '2020-01-01',
        }),
      ],
    };

    renderTasks();

    expect(rowText('Revise the schedule')).toContain(`Overdue: ${lateBy}d late`);
    expect(rowText('Send the agenda')).toContain(`Overdue: ${lateBy}d late`);
    expect(rowText('Chase the signature')).toContain(`Overdue: ${lateBy}d late`);
  });

  it('keeps a future task, a task due today, a finished task, and another deal quiet', () => {
    // WHY: a date still ahead, the due day itself, and a completed follow-up
    // are not late work. Another deal's task must not appear here at all.
    const today = new Date().toISOString().slice(0, 10);
    hookMocks.data = {
      nextCursor: null,
      items: [
        task({
          id: '00000000-0000-4000-8000-000000010011',
          title: 'Book the workshop',
          status: 'open',
          dueDate: '2099-12-31',
        }),
        task({
          id: '00000000-0000-4000-8000-000000010012',
          title: 'Confirm the room',
          status: 'open',
          dueDate: today,
        }),
        task({
          id: '00000000-0000-4000-8000-000000010013',
          title: 'Archive the brief',
          status: 'done',
          dueDate: '2020-01-01',
        }),
        task({
          id: '00000000-0000-4000-8000-000000010014',
          title: 'Other account follow-up',
          status: 'open',
          dueDate: '2020-01-01',
          oppId: OTHER_OPP,
        }),
      ],
    };

    renderTasks();

    expect(rowText('Book the workshop')).not.toMatch(/Overdue/);
    expect(rowText('Confirm the room')).not.toMatch(/Overdue/);
    expect(rowText('Archive the brief')).not.toMatch(/Overdue/);
    expect(screen.queryByText('Other account follow-up')).toBeNull();
  });
});

describe('OpportunityTabs tasks — the read', () => {
  it('shows a loading hold instead of an empty list', () => {
    // WHY: an empty list while the read is in flight is the same lie as a
    // failed read. The hold stays until the tasks settle.
    hookMocks.isLoading = true;
    renderTasks();
    expect(document.querySelector('[aria-busy="true"]')).toBeTruthy();
    expect(screen.queryByText('No tasks yet')).toBeNull();
    expect(screen.queryByText(/Overdue/)).toBeNull();
  });

  it('says the tasks did not load, and retry asks again', () => {
    // WHY: "No tasks yet" is the empty buying follow-up. A failed read still
    // has the tasks; there must be a retry instead of that empty sentence.
    hookMocks.isError = true;
    renderTasks();
    expect(screen.getByRole('alert').textContent).toContain("Couldn't load tasks");
    expect(screen.queryByText('No tasks yet')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(hookMocks.refetch).toHaveBeenCalledOnce();
  });

  it('still says the list is empty after a read that succeeded with no rows', () => {
    hookMocks.data = { items: [], nextCursor: null };
    renderTasks();
    expect(screen.getByText('No tasks yet')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
