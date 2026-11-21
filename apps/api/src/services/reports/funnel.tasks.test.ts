import { beforeEach, describe, expect, it, vi } from 'vitest';

const taskGroupBy = vi.fn();
const taskCount = vi.fn();
const orgSettingsFindUnique = vi.fn();

vi.mock('@bidstack/db', () => ({
  prisma: {
    task: { groupBy: taskGroupBy, count: taskCount },
    orgSettings: { findUnique: orgSettingsFindUnique },
  },
  Prisma: { sql: (...args: unknown[]) => args },
}));

const { getTasksReport } = await import('./funnel.service.js');

beforeEach(() => {
  taskGroupBy.mockReset().mockResolvedValue([]);
  taskCount.mockReset().mockResolvedValue(0);
  orgSettingsFindUnique.mockReset().mockResolvedValue({ timezone: 'America/Sao_Paulo' });
});

describe('getTasksReport overdue', () => {
  it('keeps a task due today in São Paulo off the overdue count at 22:00 local', async () => {
    // 2026-11-21 01:00 UTC is 2026-11-20 22:00 in America/Sao_Paulo. The civil
    // day is still 20 Nov, so a task due that day is not overdue. A UTC cut
    // uses 21 Nov and marks it overdue.
    await getTasksReport('org-1', new Date('2026-11-21T01:00:00.000Z'));

    const overdue = taskCount.mock.calls[2]![0] as {
      where: { dueDate: { lt: Date }; status: { not: string } };
    };
    expect(overdue.where.status).toEqual({ not: 'done' });
    expect(overdue.where.dueDate.lt.toISOString()).toBe('2026-11-20T00:00:00.000Z');
  });
});
