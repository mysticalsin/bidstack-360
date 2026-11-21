import { describe, expect, it } from 'vitest';

import { isTaskOverdue, taskOverdueBefore } from './task-overdue.js';

describe('task overdue calendar day', () => {
  const saoPauloEvening = new Date('2026-11-21T02:00:00.000Z');

  it('does not count the UTC due day as overdue, including the previous evening in São Paulo', () => {
    // 02:00 UTC is 23:00 on 20 Nov in America/Sao_Paulo. The stored due date is
    // a calendar day. The summary uses the UTC day, so 21 Nov is not overdue
    // and 20 Nov is.
    expect(isTaskOverdue('2026-11-21', saoPauloEvening)).toBe(false);
    expect(isTaskOverdue('2026-11-20', saoPauloEvening)).toBe(true);
    expect(isTaskOverdue(null, saoPauloEvening)).toBe(false);
    expect(taskOverdueBefore(saoPauloEvening).toISOString()).toBe('2026-11-21T00:00:00.000Z');
  });

  it('still excludes a task due today at 23:59 UTC', () => {
    const late = new Date('2026-11-21T23:59:00.000Z');
    expect(isTaskOverdue('2026-11-21', late)).toBe(false);
    expect(isTaskOverdue('2026-11-22', late)).toBe(false);
    expect(isTaskOverdue('2026-11-20', late)).toBe(true);
  });

  it('treats the first minute of the UTC day the same as the last', () => {
    const justAfter = new Date('2026-01-01T00:01:00.000Z');
    expect(isTaskOverdue('2026-01-01', justAfter)).toBe(false);
    expect(isTaskOverdue('2025-12-31', justAfter)).toBe(true);
  });
});
