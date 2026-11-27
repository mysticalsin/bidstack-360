import { describe, expect, it } from 'vitest';

import { timelineTaskHref, timelineTaskLateClause } from './deal-timeline-task';

const NOW = new Date('2026-11-25T22:30:00.000Z');
const PRICING = '00000000-0000-4000-8000-000000010001';

describe('deal timeline follow-up', () => {
  it('says an open demo follow-up is late once its UTC day has passed, and opens that task', () => {
    // WHY: seeded follow-ups such as "Submit revised pricing & SoW v2" are
    // due 15 May 2026 and still in progress. The activity tab already loads
    // the due day on the task row. Leaving it off the sentence makes a late
    // follow-up read as an ordinary "task created" line, and the title does
    // not open the task.
    const clause = timelineTaskLateClause(
      'task',
      { status: 'in_progress', dueDate: '2026-05-15T00:00:00.000Z' },
      NOW,
    );
    expect(clause).toBe('Overdue: 194d late.');
    expect(timelineTaskHref(`task-${PRICING}`, 'task')).toBe(`/tasks/${PRICING}`);

    expect(
      timelineTaskLateClause('task', { status: 'open', dueDate: '2026-05-20' }, NOW),
    ).toBe('Overdue: 189d late.');
    expect(
      timelineTaskLateClause('task', { status: 'blocked', dueDate: '2026-05-12T00:00:00.000Z' }, NOW),
    ).toBe('Overdue: 197d late.');
  });

  it('keeps due-today, future, finished, undated, and non-task rows off the late clock', () => {
    // WHY: due today is not late. A finished follow-up keeps its date. A call
    // on the same timeline is not a task, so it stays text and is not called late.
    expect(
      timelineTaskLateClause('task', { status: 'open', dueDate: '2026-11-25T00:00:00.000Z' }, NOW),
    ).toBeNull();
    expect(
      timelineTaskLateClause('task', { status: 'open', dueDate: '2026-12-01T00:00:00.000Z' }, NOW),
    ).toBeNull();
    expect(
      timelineTaskLateClause('task', { status: 'done', dueDate: '2026-05-15T00:00:00.000Z' }, NOW),
    ).toBeNull();
    expect(timelineTaskLateClause('task', { status: 'open', dueDate: null }, NOW)).toBeNull();
    expect(timelineTaskLateClause('task', { status: 'open' }, NOW)).toBeNull();
    expect(
      timelineTaskLateClause('call', { status: 'completed', dueDate: '2026-05-15T00:00:00.000Z' }, NOW),
    ).toBeNull();
    expect(timelineTaskHref('activity-call-1', 'call')).toBeNull();
    expect(timelineTaskHref('comment-c1', 'comment')).toBeNull();
  });
});
