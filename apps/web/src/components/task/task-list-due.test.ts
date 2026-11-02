import { describe, expect, it } from 'vitest';

import { isOpenTaskDueToday, isOpenTaskPastDue } from './task-list-due';

// 19:00 in America/Sao_Paulo on 1 Nov, still 1 Nov UTC.
const EVENING_UTC = new Date('2026-11-01T22:00:00Z');
// 23:00 in America/Sao_Paulo on 1 Nov, already 2 Nov UTC.
const AFTER_LOCAL_MIDNIGHT = new Date('2026-11-02T02:00:00Z');

describe('isOpenTaskDueToday', () => {
  it('keeps a task due on the UTC day in Today at 22:00Z, and leaves tomorrow out', () => {
    // WHY: the Today chip is the due-today group on the task list. Elapsed
    // time from UTC midnight is already -22h, so rounding it reads yesterday
    // and drops the task. The next UTC day is only +2h away and would round
    // into Today. Local Sao Paulo is still 1 Nov, which must not be required.
    expect(isOpenTaskDueToday({ dueDate: '2026-11-01', status: 'open' }, EVENING_UTC)).toBe(true);
    expect(isOpenTaskDueToday({ dueDate: '2026-11-02', status: 'open' }, EVENING_UTC)).toBe(false);
    expect(isOpenTaskPastDue({ dueDate: '2026-11-01', status: 'open' }, EVENING_UTC)).toBe(false);
  });

  it('treats 02:00Z as the next UTC day even though Sao Paulo is still the day before', () => {
    // WHY: local midnight must not decide. At 23:00 in Sao Paulo the calendar
    // is still 1 Nov, but the UTC day is 2 Nov, so a task due 2026-11-02 is
    // due today and a task due 2026-11-01 is not.
    expect(
      isOpenTaskDueToday({ dueDate: '2026-11-02', status: 'open' }, AFTER_LOCAL_MIDNIGHT),
    ).toBe(true);
    expect(
      isOpenTaskDueToday({ dueDate: '2026-11-01', status: 'open' }, AFTER_LOCAL_MIDNIGHT),
    ).toBe(false);
    expect(isOpenTaskPastDue({ dueDate: '2026-11-01', status: 'open' }, AFTER_LOCAL_MIDNIGHT)).toBe(
      true,
    );
  });
});
