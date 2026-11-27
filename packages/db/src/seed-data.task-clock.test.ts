import { describe, expect, it } from 'vitest';

import { FIXTURE_TASK_DUE_DATES } from '@bidstack/shared';

import { fixtureTasks } from './seed-data.js';

describe('open fixture task due dates and the demo clock', () => {
  it('lists the same open due dates the read-time clock slides', () => {
    // WHY: the clock table is a copy of the seed. If a new open fixture date
    // lands only in one of them, a restored snapshot ages out of the window.
    const open = Object.fromEntries(
      fixtureTasks
        .filter((t) => t.status !== 'done' && t.dueDate)
        .map((t) => [t.id, t.dueDate]),
    );
    expect(open).toEqual(FIXTURE_TASK_DUE_DATES);
  });
});
