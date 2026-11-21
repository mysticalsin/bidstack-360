import { beforeEach, describe, expect, it, vi } from 'vitest';

const taskGroupBy = vi.fn();
const taskCount = vi.fn();

vi.mock('@bidstack/db', () => ({
  prisma: {
    task: { groupBy: taskGroupBy, count: taskCount },
  },
  Prisma: { sql: (...args: unknown[]) => args },
}));

const { getTasksReport } = await import('./funnel.service.js');

beforeEach(() => {
  taskGroupBy.mockReset().mockResolvedValue([]);
  taskCount.mockReset().mockResolvedValue(0);
});

describe('getTasksReport overdue', () => {
  it('cuts overdue at the UTC day, not at the current timestamp', async () => {
    // WHY: due_date is a calendar date. `dueDate < now` counts a task due
    // today as overdue for the whole UTC day. The summary uses due_date <
    // UTC today, so the report must use that same cut or the two overdue
    // numbers disagree. 02:00 UTC is still the previous evening in São Paulo.
    await getTasksReport('org-1', new Date('2026-11-21T02:00:00.000Z'));

    const overdue = taskCount.mock.calls[2]![0] as {
      where: { dueDate: { lt: Date }; status: { not: string } };
    };
    expect(overdue.where.status).toEqual({ not: 'done' });
    expect(overdue.where.dueDate.lt.toISOString()).toBe('2026-11-21T00:00:00.000Z');
  });
});
