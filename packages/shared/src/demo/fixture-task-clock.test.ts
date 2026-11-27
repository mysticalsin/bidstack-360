import { describe, expect, it } from 'vitest';

import {
  FIXTURE_TASK_DUE_DATES,
  fixtureTaskShiftDays,
  projectFixtureTaskDueDate,
} from './fixture-task-clock.js';

const NOW = new Date('2026-11-27T12:00:00.000Z');
const LATER = new Date('2027-06-15T00:00:00.000Z');
const EARLIEST_ID = '00000000-0000-4000-8000-000000010003';
const PLUS_THREE_ID = '00000000-0000-4000-8000-000000010001';
const STORED_EARLIEST = new Date('2026-05-12T00:00:00.000Z');

function dueSoonCount(now: Date, mode: string): number {
  const today = Date.parse(now.toISOString().slice(0, 10) + 'T00:00:00.000Z');
  const next = today + 7 * 86_400_000;
  let count = 0;
  for (const [id, dueDate] of Object.entries(FIXTURE_TASK_DUE_DATES)) {
    const projected = projectFixtureTaskDueDate({ id, status: 'open', dueDate }, now, mode);
    const ms = Date.parse(`${projected}T00:00:00.000Z`);
    if (ms >= today && ms < next) count += 1;
  }
  return count;
}

describe('fixture task due clock', () => {
  it('moves the earliest open fixture task to tomorrow and keeps the three-day gap', () => {
    // WHY: fixture due dates are absolute May 2026. On 2026-11-27 every open
    // task is overdue, due-soon is 0, and the current-month calendar is empty.
    const early = { id: EARLIEST_ID, status: 'in_progress', dueDate: STORED_EARLIEST };
    const later = { id: PLUS_THREE_ID, status: 'in_progress', dueDate: '2026-05-15' };

    expect(projectFixtureTaskDueDate(early, NOW, 'demo')).toEqual(new Date('2026-11-28T00:00:00.000Z'));
    expect(projectFixtureTaskDueDate(later, NOW, 'demo')).toBe('2026-12-01');
    expect(early.dueDate).toBe(STORED_EARLIEST);
    expect(dueSoonCount(NOW, 'demo')).toBe(3);
    expect(dueSoonCount(NOW, 'real')).toBe(0);
    expect(fixtureTaskShiftDays(LATER)).toBe(400);
    expect(projectFixtureTaskDueDate(early, LATER, 'demo')).toEqual(new Date('2027-06-16T00:00:00.000Z'));
  });

  it('does not move a task unless the mode is exactly demo and the row is still the seed', () => {
    const row = { id: EARLIEST_ID, status: 'open', dueDate: STORED_EARLIEST };
    for (const mode of ['real', 'Demo', 'DEMO', 'demo-x', ' demo', 'notdemo', ''] as const) {
      expect(projectFixtureTaskDueDate(row, NOW, mode)).toEqual(STORED_EARLIEST);
    }
    expect(projectFixtureTaskDueDate(row, NOW, undefined)).toEqual(STORED_EARLIEST);
    const edited = new Date('2026-05-13T00:00:00.000Z');
    expect(projectFixtureTaskDueDate({ ...row, dueDate: edited }, NOW, 'demo')).toEqual(edited);
    expect(projectFixtureTaskDueDate({ ...row, status: 'done' }, NOW, 'demo')).toEqual(STORED_EARLIEST);
    expect(
      projectFixtureTaskDueDate({ ...row, id: '00000000-0000-4000-8000-000000019999' }, NOW, 'demo'),
    ).toEqual(STORED_EARLIEST);
    expect(fixtureTaskShiftDays(new Date('2026-05-12T00:00:00.000Z'))).toBe(0);
    expect(projectFixtureTaskDueDate(row, new Date('2026-05-11T00:00:00.000Z'), 'demo')).toEqual(STORED_EARLIEST);
  });
});
