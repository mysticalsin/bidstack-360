// Demo seed files the Stellantis handover as done, two days before 25 Nov 2026,
// on the Monday of the current week. The pricing annex is still open on
// Saturday of that same month. The calendar painted the finished handover, so
// the week looked like it still had work.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

const HANDOVER = task({
  id: '33333333-3333-4333-8333-333333333333',
  title: 'Kickoff handover to delivery',
  dueDate: '2026-11-23',
  status: 'done',
});

const ANNEX = task({
  id: '11111111-1111-4111-8111-111111111111',
  title: 'Prepare pricing annex for IKEA',
  dueDate: '2026-11-28',
  status: 'open',
});

const BLOCKED = task({
  id: '22222222-2222-4222-8222-222222222222',
  title: 'Security questionnaire response',
  dueDate: '2026-11-29',
  status: 'blocked',
});

function renderCalendar(tasks: Task[]) {
  return render(
    <MemoryRouter>
      <TaskCalendar tasks={tasks} />
    </MemoryRouter>,
  );
}

describe('TaskCalendar finished follow-ups', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('leaves the finished handover off the week and keeps the open annex', () => {
    renderCalendar([HANDOVER, ANNEX, BLOCKED]);

    expect(screen.queryByRole('link', { name: 'Kickoff handover to delivery' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Prepare pricing annex for IKEA' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Security questionnaire response' })).toBeTruthy();
    expect(screen.queryByText('Finished follow-ups stay off this calendar.')).toBeNull();
  });

  it('says why the month is empty when every follow-up in it is finished', () => {
    renderCalendar([HANDOVER]);

    expect(screen.queryByRole('link', { name: 'Kickoff handover to delivery' })).toBeNull();
    expect(screen.getByText('Finished follow-ups stay off this calendar.')).toBeTruthy();
  });
});
