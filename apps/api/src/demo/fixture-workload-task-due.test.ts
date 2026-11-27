import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  FIXTURE_WORKLOAD_TASK_DUE,
  fixtureWorkloadTasksNotOverdue,
  projectFixtureWorkloadTaskDue,
} from './fixture-workload-task-due.js';

const NOW = new Date('2026-11-27T12:00:00.000Z');
const LATER = new Date('2027-06-15T00:00:00.000Z');
const EARLY_ID = '00000000-0000-4000-8000-000000010003';
const PLUS_THREE_ID = '00000000-0000-4000-8000-000000010001';
const STORED_EARLY = new Date('2026-05-12T00:00:00.000Z');

function overdueCount(now: Date, mode: string): number {
  const today = Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`);
  const held = new Set(
    fixtureWorkloadTasksNotOverdue(now, mode).map(
      (row) => `${row.id}:${row.dueDate.toISOString()}`,
    ),
  );
  let count = 0;
  for (const [id, dueDate] of Object.entries(FIXTURE_WORKLOAD_TASK_DUE)) {
    const stored = new Date(`${dueDate}T00:00:00.000Z`);
    if (held.has(`${id}:${stored.toISOString()}`)) continue;
    if (stored.getTime() < today) count += 1;
  }
  return count;
}

describe('fixture workload task due', () => {
  it('keeps the seven open fixture tasks out of the overdue count once their dates have aged', () => {
    // WHY: three overdue follow-ups mark a desk over capacity. The open fixture
    // tasks are dated 2026-05-12 through 2026-05-23. On 2026-11-27 every one of
    // them is past, so the workload page says those desks are over capacity.
    const early = { id: EARLY_ID, status: 'in_progress', dueDate: STORED_EARLY };
    const later = { id: PLUS_THREE_ID, status: 'in_progress', dueDate: '2026-05-15' };

    expect(projectFixtureWorkloadTaskDue(early, NOW, 'demo')).toEqual(
      new Date('2026-11-28T00:00:00.000Z'),
    );
    expect(projectFixtureWorkloadTaskDue(later, NOW, 'demo')).toBe('2026-12-01');
    expect(early.dueDate).toBe(STORED_EARLY);

    const held = fixtureWorkloadTasksNotOverdue(NOW, 'demo');
    expect(held.map((row) => row.id).sort()).toEqual(Object.keys(FIXTURE_WORKLOAD_TASK_DUE).sort());
    expect(overdueCount(NOW, 'demo')).toBe(0);
    expect(overdueCount(NOW, 'real')).toBe(Object.keys(FIXTURE_WORKLOAD_TASK_DUE).length);
    expect(projectFixtureWorkloadTaskDue(early, LATER, 'demo')).toEqual(
      new Date('2027-06-16T00:00:00.000Z'),
    );
  });

  it('does not hold a task out unless the mode is exactly demo and the row is still the seed', () => {
    const row = { id: EARLY_ID, status: 'open', dueDate: STORED_EARLY };
    for (const mode of ['real', 'Demo', 'DEMO', 'demo-x', ' demo', 'notdemo', ''] as const) {
      expect(projectFixtureWorkloadTaskDue(row, NOW, mode)).toEqual(STORED_EARLY);
      expect(fixtureWorkloadTasksNotOverdue(NOW, mode)).toEqual([]);
    }
    expect(projectFixtureWorkloadTaskDue(row, NOW, undefined)).toEqual(STORED_EARLY);
    expect(fixtureWorkloadTasksNotOverdue(NOW, undefined)).toEqual([]);
    const edited = new Date('2026-05-13T00:00:00.000Z');
    expect(projectFixtureWorkloadTaskDue({ ...row, dueDate: edited }, NOW, 'demo')).toEqual(edited);
    expect(
      fixtureWorkloadTasksNotOverdue(NOW, 'demo').some(
        (held) => held.dueDate.getTime() === edited.getTime(),
      ),
    ).toBe(false);
    expect(projectFixtureWorkloadTaskDue({ ...row, status: 'done' }, NOW, 'demo')).toEqual(
      STORED_EARLY,
    );
    expect(
      projectFixtureWorkloadTaskDue(
        { ...row, id: '00000000-0000-4000-8000-000000019999' },
        NOW,
        'demo',
      ),
    ).toEqual(STORED_EARLY);
    expect(fixtureWorkloadTasksNotOverdue(new Date('2026-05-11T00:00:00.000Z'), 'demo')).toEqual(
      [],
    );
    expect(
      projectFixtureWorkloadTaskDue(row, new Date('2026-05-11T00:00:00.000Z'), 'demo'),
    ).toEqual(STORED_EARLY);
  });

  it('lists the same open due dates the seed writes, and the workload query uses that list', () => {
    // WHY: the workload clock is a copy of fixtureTasks. A new open date in only
    // one of them still counts as overdue on the capacity screen.
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
    expect(seeded).toEqual(FIXTURE_WORKLOAD_TASK_DUE);

    const route = readFileSync(
      path.resolve(import.meta.dirname, '../routes/analytics-workload.ts'),
      'utf8',
    );
    const fn = route.slice(route.indexOf('async function aggregateTasks'));
    expect(fn).toContain('fixtureWorkloadTasksNotOverdue');
    expect(fn).toContain("status: { not: 'done' }");
    expect(fn).toContain('dueDate: { lt: startOfTodayUTC }');
  });
});
