import { describe, expect, it } from 'vitest';

import type { Task } from '@bidstack/shared';

import { orderTaskList } from './task-list-order';

function task(partial: Pick<Task, 'id' | 'title' | 'dueDate' | 'createdAt'> & Partial<Task>): Task {
  return {
    oppId: null,
    status: 'open',
    assignee: null,
    ...partial,
  };
}

const ARITZIA = task({
  id: 'aritzia',
  title: 'Schedule Aritzia kickoff',
  dueDate: '2026-05-12',
  createdAt: '2026-05-08T12:00:00.000Z',
});
const PRICING = task({
  id: 'pricing',
  title: 'Submit revised pricing & SoW v2',
  dueDate: '2026-05-15',
  createdAt: '2026-05-01T12:00:00.000Z',
});
const WORKSHOP = task({
  id: 'workshop',
  title: 'Architecture workshop, DNB',
  dueDate: '2026-05-19',
  createdAt: '2026-05-10T12:00:00.000Z',
});
const UNDATED = task({
  id: 'undated',
  title: 'Follow-up with no day',
  dueDate: null,
  createdAt: '2026-05-11T12:00:00.000Z',
});

describe('orderTaskList', () => {
  it('treats Recent as the latest filing, not the route due-date order', () => {
    // WHY: the tasks route returns earliest due day first. Recent must put
    // the 10 May workshop ahead of the 12 May kickoff that was filed earlier.
    const ordered = orderTaskList([ARITZIA, PRICING, WORKSHOP], 'natural');
    expect(ordered.map((row) => row.title)).toEqual([
      'Architecture workshop, DNB',
      'Schedule Aritzia kickoff',
      'Submit revised pricing & SoW v2',
    ]);
  });

  it('puts the earliest due day first when Due date is chosen, and leaves a missing day last', () => {
    // WHY: Due date is the bid clock. A follow-up with no day is not due
    // before the 12 May kickoff, even if it was filed later.
    const ordered = orderTaskList([WORKSHOP, UNDATED, PRICING, ARITZIA], 'due');
    expect(ordered.map((row) => row.title)).toEqual([
      'Schedule Aritzia kickoff',
      'Submit revised pricing & SoW v2',
      'Architecture workshop, DNB',
      'Follow-up with no day',
    ]);
  });

  it('keeps a dragged follow-up ahead of a newer filing on Recent', () => {
    // WHY: drag is the order the person just set. The next render must not
    // snap that row back to createdAt.
    const ordered = orderTaskList([WORKSHOP, PRICING], 'natural', (id) =>
      id === PRICING.id ? 0 : Number.POSITIVE_INFINITY,
    );
    expect(ordered.map((row) => row.id)).toEqual([PRICING.id, WORKSHOP.id]);
  });

  it('does not let a drag bury the earlier due day when Due date is chosen', () => {
    // WHY: Due date is the deadline order. A personal drag belongs to Recent.
    const ordered = orderTaskList([WORKSHOP, ARITZIA], 'due', (id) =>
      id === WORKSHOP.id ? 0 : Number.POSITIVE_INFINITY,
    );
    expect(ordered.map((row) => row.id)).toEqual([ARITZIA.id, WORKSHOP.id]);
  });
});
