import { describe, expect, it } from 'vitest';

import { projectedTaskDueSql } from './fixture-task-due-sql.js';

const AGED = new Date('2026-11-27T00:00:00.000Z');
const AHEAD = new Date('2026-05-10T00:00:00.000Z');

describe('projected task due SQL', () => {
  it('keeps the stored column unless demo dates have aged', () => {
    // WHY: the badge counts due_date in Postgres. A serializer-only slide
    // would leave the overdue count and due-soon on the May dates.
    const real = projectedTaskDueSql(AGED, 'real');
    expect(real.strings.join('')).toBe('due_date');
    expect(real.values).toEqual([]);

    const ahead = projectedTaskDueSql(AHEAD, 'demo');
    expect(ahead.strings.join('')).toBe('due_date');

    const demo = projectedTaskDueSql(AGED, 'demo');
    const text = demo.strings.join('?');
    expect(text).toContain('WHEN id = ?::uuid');
    expect(text).toContain("status <> 'done'");
    expect(text).toContain('(due_date + ?::integer)');
    expect(text).toContain('ELSE due_date END');
    expect(demo.values).toContain('00000000-0000-4000-8000-000000010003');
    expect(demo.values).toContain('2026-05-12');
    expect(demo.values).toContain(200);
    expect(demo.values).not.toContain('00000000-0000-4000-8000-000000019999');
  });
});
