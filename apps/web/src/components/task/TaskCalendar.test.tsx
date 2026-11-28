import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import { TaskCalendar } from './TaskCalendar';
import type { Task } from '@bidstack/shared';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}));

const NOW = new Date('2026-11-25T18:00:00.000Z');

function task(partial: Pick<Task, 'id' | 'title' | 'dueDate' | 'status'>): Task {
  return {
    oppId: null,
    assignee: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...partial,
  };
}

function renderCalendar(tasks: Task[]) {
  return render(
    <MemoryRouter>
      <TaskCalendar tasks={tasks} now={NOW} />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
});

describe('TaskCalendar', () => {
  it('opens on the month that holds the open follow-ups and links each chip to the task', () => {
    renderCalendar([
      task({
        id: 'mapfre',
        title: 'Confirm MAPFRE budget owner',
        dueDate: '2026-05-23',
        status: 'open',
      }),
      task({
        id: 'rush',
        title: 'Final commercial review',
        dueDate: '2026-05-15',
        status: 'in_progress',
      }),
    ]);

    expect(screen.getByRole('heading', { name: 'May 2026' })).toBeTruthy();
    const late = screen.getByRole('link', { name: 'Final commercial review' });
    expect(late.getAttribute('href')).toBe('/tasks/rush');
    // The due day is the UTC calendar day, so the chip sits on the 15th.
    expect(late.parentElement?.parentElement?.textContent).toContain('15');
    expect(late.parentElement?.parentElement?.textContent).not.toMatch(/^14/);
  });

  it('says why the calendar is not on the current month', () => {
    renderCalendar([
      task({
        id: 'mapfre',
        title: 'Confirm MAPFRE budget owner',
        dueDate: '2026-05-23',
        status: 'open',
      }),
    ]);

    expect(
      screen.getByText('The latest open follow-up in this list is in this month.'),
    ).toBeTruthy();
  });
});
