import { describe, expect, it } from 'vitest';

import {
  isOpenTaskForUser,
  navigationBadgeCount,
  taskSummaryToday,
  tasksPageCount,
  type CountableTask,
} from './open-tasks-for-user.js';

// 22:00 on 20 Nov 2026 in America/Sao_Paulo (UTC−3, no DST).
const AT_22_SAO_PAULO = new Date('2026-11-21T01:00:00.000Z');
const ORG_ZONE = 'America/Sao_Paulo';
const ORG = 'org-synthetic';
const USER = 'user-synthetic';

function row(dueDate: string): CountableTask {
  return {
    orgId: ORG,
    assigneeId: USER,
    status: 'open',
    dueDate,
    deletedAt: null,
  };
}

const rows: CountableTask[] = [
  ...Array.from({ length: 7 }, () => row('2026-11-19')),
  row('2026-11-20'),
];

describe('task summary at 22:00 São Paulo', () => {
  it('counts a task due Nov 20 as due today, not overdue, and the badge equals the page', () => {
    expect(AT_22_SAO_PAULO.toISOString()).toBe('2026-11-21T01:00:00.000Z');
    const today = taskSummaryToday(AT_22_SAO_PAULO, ORG_ZONE);
    // UTC has already dated this instant Nov 21. The org's civil day is Nov 20.
    expect(today).toBe('2026-11-20');

    const nov20 = rows.filter((task) => task.dueDate === '2026-11-20');
    expect(nov20).toHaveLength(1);
    expect(nov20.every((task) => task.dueDate === today)).toBe(true);
    expect(nov20.every((task) => task.dueDate !== null && task.dueDate < today)).toBe(false);

    const badge = navigationBadgeCount(rows, ORG, USER, today);
    const page = tasksPageCount(rows, ORG, USER, today);
    expect(badge).toBe(page);
    expect(page).toBe(8);

    const open = rows.filter((task) => isOpenTaskForUser(task, ORG, USER));
    const overdue = open.filter((task) => task.dueDate !== null && task.dueDate < today);
    const dueToday = open.filter((task) => task.dueDate === today);
    expect(overdue).toHaveLength(7);
    expect(dueToday).toHaveLength(1);
  });
});
