// The nav badge and the Tasks page must count the same set: open tasks
// assigned to the signed-in user. A task due on the UTC calendar day is the
// reported off-by-one. formatDate parses YYYY-MM-DD as UTC midnight
// (apps/web/src/lib/format.ts:63), so in America/Sao_Paulo that instant is
// the previous evening and the row looks overdue, while the badge's
// `due_date < today` comparison leaves it out.
import { describe, expect, it } from 'vitest';

import {
  isOpenTaskForUser,
  navigationBadgeCount,
  tasksPageCount,
  type CountableTask,
  type CountableTaskStatus,
} from './open-tasks-for-user.js';

const ORG = 'org-synthetic';
const USER = 'user-synthetic';
const TODAY_UTC = '2026-11-21';

function task(overrides: Partial<CountableTask> = {}): CountableTask {
  return {
    orgId: ORG,
    assigneeId: USER,
    status: 'open',
    dueDate: '2026-11-20',
    deletedAt: null,
    ...overrides,
  };
}

function badge(rows: readonly CountableTask[]): number {
  return navigationBadgeCount(rows, ORG, USER, TODAY_UTC);
}

function page(rows: readonly CountableTask[]): number {
  return tasksPageCount(rows, ORG, USER, TODAY_UTC);
}

describe('open tasks for this user', () => {
  it('reproduces badge 7 vs tasks page 8 on the America/Sao_Paulo due-today boundary', () => {
    // Seven tasks are already past the UTC day. The eighth is due on the UTC
    // day itself: formatDate shows it as Nov 20 in Sao Paulo, and daysUntil
    // rounds it to overdue after 12:00 UTC, but the badge's date comparison
    // (`due_date < today`) does not include it. The page lists every row.
    const dueTodayUtc = TODAY_UTC;
    const shownInSaoPaulo = new Date(dueTodayUtc).toLocaleDateString('en-US', {
      timeZone: 'America/Sao_Paulo',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
    expect(shownInSaoPaulo).toBe('Nov 20, 2026');

    const rows = [
      ...Array.from({ length: 7 }, () =>
        task({ dueDate: '2026-11-20', assigneeId: USER, status: 'open' }),
      ),
      task({ dueDate: dueTodayUtc, assigneeId: USER, status: 'open' }),
    ];

    expect(page(rows)).toBe(8);
    expect(badge(rows)).toBe(page(rows));
  });

  it('keeps a due-today task after 12:00 UTC, when daysUntil has already rounded it to overdue', () => {
    const due = TODAY_UTC;
    const now = Date.parse('2026-11-21T15:00:00.000Z');
    const daysUntil = Math.round((Date.parse(`${due}T00:00:00.000Z`) - now) / 86_400_000);
    // The client overdue chip uses this rounding (apps/web/src/lib/format.ts:70).
    expect(daysUntil).toBe(-1);

    const rows = [task({ dueDate: due })];
    expect(badge(rows)).toBe(1);
    expect(page(rows)).toBe(1);
  });

  it('includes open work on either side of UTC midnight, including a null due date and a snoozed future date', () => {
    const rows = [
      task({ dueDate: '2026-11-20' }),
      task({ dueDate: TODAY_UTC }),
      task({ dueDate: '2026-11-22', status: 'in_progress' }),
      task({ dueDate: null, status: 'blocked' }),
    ];
    expect(badge(rows)).toBe(4);
    expect(page(rows)).toBe(4);
  });

  it('excludes done, other people, unassigned, deleted, and other orgs', () => {
    const rows = [
      task({ status: 'done', dueDate: '2026-11-01' }),
      task({ assigneeId: 'someone-else', dueDate: '2026-11-01' }),
      task({ assigneeId: null, dueDate: '2026-11-01' }),
      task({ deletedAt: '2026-11-01T00:00:00.000Z', dueDate: '2026-11-01' }),
      task({ orgId: 'other-org', dueDate: '2026-11-01' }),
      task({ status: 'open', dueDate: '2026-11-01' }),
    ];
    expect(badge(rows)).toBe(1);
    expect(page(rows)).toBe(1);
  });

  it('badge count equals page count across generated task sets', () => {
    const rand = mulberry32(0x5a0b1021);
    const statuses: CountableTaskStatus[] = ['open', 'in_progress', 'blocked', 'done'];
    for (let set = 0; set < 40; set += 1) {
      const rows: CountableTask[] = [];
      const size = Math.floor(rand() * 24);
      for (let n = 0; n < size; n += 1) {
        const offset = Math.floor(rand() * 11) - 5;
        const due = new Date(Date.UTC(2026, 10, 21 + offset));
        const dueDate = rand() < 0.15 ? null : due.toISOString().slice(0, 10);
        const assigneeRoll = rand();
        rows.push(
          task({
            orgId: rand() < 0.1 ? 'other-org' : ORG,
            assigneeId: assigneeRoll < 0.6 ? USER : assigneeRoll < 0.85 ? 'someone-else' : null,
            status: statuses[Math.floor(rand() * statuses.length)]!,
            dueDate,
            deletedAt: rand() < 0.1 ? '2026-11-01T00:00:00.000Z' : null,
          }),
        );
      }
      // Always cover the due-today edge inside the generated set.
      rows.push(task({ dueDate: TODAY_UTC, status: 'open' }));
      expect(badge(rows), `set ${set}`).toBe(page(rows));
      expect(badge(rows), `set ${set} against the shared predicate`).toBe(
        rows.filter((row) => isOpenTaskForUser(row, ORG, USER)).length,
      );
    }
  });
});

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
