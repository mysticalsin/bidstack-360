import { describe, expect, it } from 'vitest';

import { calendarFocusMonth, taskDueUtcDay, taskRecordHref } from './task-calendar-focus';

// Demo follow-ups are dated May 2026. Opening the calendar on 25 Nov 2026
// paints an empty November, so the late work is six clicks back and easy to
// miss. A due day is a UTC calendar day: local midnight must not move it.
describe('task calendar focus', () => {
  const now = new Date('2026-11-25T18:00:00.000Z');

  it('reads a date-only due day as that UTC day', () => {
    expect(taskDueUtcDay('2026-05-15')).toEqual({ year: 2026, monthIndex: 4, day: 15 });
    expect(taskDueUtcDay('2026-05-15T00:00:00.000Z')).toEqual({
      year: 2026,
      monthIndex: 4,
      day: 15,
    });
    expect(taskDueUtcDay(null)).toBeNull();
    expect(taskDueUtcDay('not-a-date')).toBeNull();
  });

  it('opens on the latest month that still has an open follow-up when this month has none', () => {
    expect(
      calendarFocusMonth(
        [
          { dueDate: '2026-05-12', status: 'in_progress' },
          { dueDate: '2026-05-23', status: 'open' },
          { dueDate: '2026-04-02', status: 'open' },
          { dueDate: '2026-03-01', status: 'done' },
        ],
        now,
      ),
    ).toEqual({ year: 2026, monthIndex: 4 });
  });

  it('stays on this month when an open follow-up is due here, even if older ones are late', () => {
    expect(
      calendarFocusMonth(
        [
          { dueDate: '2026-05-12', status: 'open' },
          { dueDate: '2026-11-25', status: 'open' },
        ],
        now,
      ),
    ).toEqual({ year: 2026, monthIndex: 10 });
  });

  it('opens on the next open follow-up when nothing is late or due this month', () => {
    expect(
      calendarFocusMonth([{ dueDate: '2027-01-08', status: 'blocked' }], now),
    ).toEqual({ year: 2027, monthIndex: 0 });
  });

  it('stays on this month when every dated follow-up is already done', () => {
    expect(calendarFocusMonth([{ dueDate: '2026-05-12', status: 'done' }], now)).toEqual({
      year: 2026,
      monthIndex: 10,
    });
  });

  it('opens the task record, not a search the list ignores', () => {
    expect(taskRecordHref('00000000-0000-4000-8000-000000010005')).toBe(
      '/tasks/00000000-0000-4000-8000-000000010005',
    );
  });
});
