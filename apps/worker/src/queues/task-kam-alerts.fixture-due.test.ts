import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  FIXTURE_TASK_ALERT_DUE_DATES,
  fixtureTasksOutsideAlertWindow,
  projectFixtureTaskAlertDue,
} from './task-kam-alerts.fixture-due.js';

const NOW = new Date('2026-11-27T12:00:00.000Z');
const LATER = new Date('2027-06-15T00:00:00.000Z');
const EARLY_ID = '00000000-0000-4000-8000-000000010003';
const PLUS_THREE_ID = '00000000-0000-4000-8000-000000010001';
const STORED_EARLY = new Date('2026-05-12T00:00:00.000Z');

describe('fixture task alert clock', () => {
  it('moves the earliest open fixture task to tomorrow and keeps the three-day gap', () => {
    // WHY: the due-alert scan treats a stored May date as overdue. On
    // 2026-11-27 that raises an overdue nudge and the May rows fill the
    // front of the batch. The card clock slides the same set to tomorrow.
    const early = { id: EARLY_ID, status: 'in_progress', dueDate: STORED_EARLY };
    const later = {
      id: PLUS_THREE_ID,
      status: 'in_progress',
      dueDate: new Date('2026-05-15T00:00:00.000Z'),
    };

    expect(projectFixtureTaskAlertDue(early, NOW, 'demo')).toEqual(new Date('2026-11-28T00:00:00.000Z'));
    expect(projectFixtureTaskAlertDue(later, NOW, 'demo')).toEqual(new Date('2026-12-01T00:00:00.000Z'));
    expect(early.dueDate).toBe(STORED_EARLY);
    expect(projectFixtureTaskAlertDue(early, LATER, 'demo')).toEqual(new Date('2027-06-16T00:00:00.000Z'));

    const outside = fixtureTasksOutsideAlertWindow(NOW, 'demo').map((row) => row.id);
    expect(outside).toContain('00000000-0000-4000-8000-000000010005');
    expect(outside).not.toContain(EARLY_ID);
    expect(outside).not.toContain('00000000-0000-4000-8000-000000010006');
  });

  it('does not move a task unless the mode is exactly demo and the row is still the seed', () => {
    const row = { id: EARLY_ID, status: 'open', dueDate: STORED_EARLY };
    for (const mode of ['real', 'Demo', 'DEMO', 'demo-x', ' demo', 'notdemo', ''] as const) {
      expect(projectFixtureTaskAlertDue(row, NOW, mode)).toBe(STORED_EARLY);
      expect(fixtureTasksOutsideAlertWindow(NOW, mode)).toEqual([]);
    }
    expect(projectFixtureTaskAlertDue(row, NOW, undefined)).toBe(STORED_EARLY);
    const edited = new Date('2026-05-13T00:00:00.000Z');
    expect(projectFixtureTaskAlertDue({ ...row, dueDate: edited }, NOW, 'demo')).toBe(edited);
    expect(projectFixtureTaskAlertDue({ ...row, status: 'done' }, NOW, 'demo')).toBe(STORED_EARLY);
    expect(
      projectFixtureTaskAlertDue(
        { ...row, id: '00000000-0000-4000-8000-000000019999' },
        NOW,
        'demo',
      ),
    ).toBe(STORED_EARLY);
    expect(projectFixtureTaskAlertDue(row, new Date('2026-05-11T00:00:00.000Z'), 'demo')).toBe(STORED_EARLY);
    expect(fixtureTasksOutsideAlertWindow(new Date('2026-05-11T00:00:00.000Z'), 'demo')).toEqual([]);
  });

  it('lists the same open due dates the seed writes', () => {
    // WHY: the alert clock is a copy of fixtureTasks. A new open date in only
    // one of them ages out of the scan while the other still slides.
    const source = readFileSync(
      path.resolve(import.meta.dirname, '../../../../packages/db/src/seed-data.tasks-leads.ts'),
      'utf8',
    );
    const seeded: Record<string, string> = {};
    for (const block of source.split(/\{\s*id:/).slice(1)) {
      const id = block.match(/'([^']+)'/)?.[1];
      const due = block.match(/dueDate:\s*'([^']+)'/)?.[1];
      const status = block.match(/status:\s*TaskStatus\.(\w+)/)?.[1];
      if (id && due && status && status !== 'done') seeded[id] = due;
    }
    expect(seeded).toEqual(FIXTURE_TASK_ALERT_DUE_DATES);
  });
});
