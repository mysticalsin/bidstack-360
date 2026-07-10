// Mocked-prisma tests for the task-due / KAM-staleness scan functions —
// mirrors workflow-dispatch.test.ts's pattern (mock @bidstack/db, exercise the
// exported scan function directly, assert the org-scoped write + the dedupe
// skip). WHY: proves the worker (a) only ever notifies the real
// assignee/owner, org-scoped, and (b) never re-notifies an (entity, day) it
// already alerted — the double-notify path is exactly the alert-fatigue bug
// this design exists to prevent.
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type pino from 'pino';

const mocks = vi.hoisted(() => ({
  taskFindMany: vi.fn(),
  initiativeFindMany: vi.fn(),
  notificationFindFirst: vi.fn(),
  notificationCreate: vi.fn(),
  notificationPrefFindUnique: vi.fn(),
}));

vi.mock('@bidstack/db', () => ({
  prisma: {
    task: { findMany: mocks.taskFindMany },
    kamInitiative: { findMany: mocks.initiativeFindMany },
    notification: { findFirst: mocks.notificationFindFirst, create: mocks.notificationCreate },
    notificationPref: { findUnique: mocks.notificationPrefFindUnique },
  },
  TaskStatus: { open: 'open', in_progress: 'in_progress', blocked: 'blocked', done: 'done' },
  InitiativeStage: { initiative: 'initiative', lead: 'lead', opportunity: 'opportunity', dropped: 'dropped' },
}));

import { scanTaskDueAlerts, scanKamStaleness } from './task-kam-alerts.js';

const log = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: () => log,
} as unknown as pino.Logger;

const NOW = new Date('2026-07-01T12:00:00Z');
const ORG_ID = 'org-1';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.notificationPrefFindUnique.mockResolvedValue(null); // no row = deliver (default)
  mocks.notificationCreate.mockResolvedValue({ id: 'notif-1', type: 'task_due', title: 't', url: '/x' });
});

describe('scanTaskDueAlerts', () => {
  it('notifies the assignee of a task due tomorrow, org-scoped', async () => {
    mocks.taskFindMany.mockResolvedValue([
      {
        id: 'task-1',
        orgId: ORG_ID,
        title: 'Send proposal',
        dueDate: new Date('2026-07-02T00:00:00Z'), // tomorrow
        assigneeId: 'user-1',
      },
    ]);
    mocks.notificationFindFirst.mockResolvedValue(null); // not yet alerted today

    const created = await scanTaskDueAlerts(NOW, log);

    expect(created).toBe(1);
    expect(mocks.notificationCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          orgId: ORG_ID,
          userId: 'user-1',
          type: 'task_due',
          entityType: 'task',
          entityId: 'task-1',
        }),
      }),
    );
  });

  it('skips a task already alerted today (dedupe)', async () => {
    mocks.taskFindMany.mockResolvedValue([
      {
        id: 'task-1',
        orgId: ORG_ID,
        title: 'Send proposal',
        dueDate: new Date('2026-06-25T00:00:00Z'), // overdue
        assigneeId: 'user-1',
      },
    ]);
    // An identical dedupe url already exists — this run must not re-notify.
    mocks.notificationFindFirst.mockResolvedValue({ id: 'existing' });

    const created = await scanTaskDueAlerts(NOW, log);

    expect(created).toBe(0);
    expect(mocks.notificationCreate).not.toHaveBeenCalled();
  });

  it('does not notify a task due 3 days out — outside the within-24h window', async () => {
    mocks.taskFindMany.mockResolvedValue([
      {
        id: 'task-1',
        orgId: ORG_ID,
        title: 'Later',
        dueDate: new Date('2026-07-04T00:00:00Z'),
        assigneeId: 'user-1',
      },
    ]);

    const created = await scanTaskDueAlerts(NOW, log);

    expect(created).toBe(0);
    expect(mocks.notificationFindFirst).not.toHaveBeenCalled();
    expect(mocks.notificationCreate).not.toHaveBeenCalled();
  });

  it('respects an explicit taskDueSoon opt-out — the assignee is not notified', async () => {
    // WHY this case must exist: "respecting the relevant pref" is an explicit
    // task requirement, and the pref-gating branch (task-kam-alerts.ts's
    // `if (pref && pref.taskDueSoon === false) return false;`) had zero
    // coverage — a regression that inverted or dropped that check would slip
    // through silently.
    mocks.taskFindMany.mockResolvedValue([
      {
        id: 'task-1',
        orgId: ORG_ID,
        title: 'Send proposal',
        dueDate: new Date('2026-07-02T00:00:00Z'), // tomorrow — otherwise due
        assigneeId: 'user-1',
      },
    ]);
    mocks.notificationPrefFindUnique.mockResolvedValue({ taskDueSoon: false });

    const created = await scanTaskDueAlerts(NOW, log);

    expect(created).toBe(0);
    expect(mocks.notificationCreate).not.toHaveBeenCalled();
  });
});

describe('scanKamStaleness', () => {
  it('notifies the owner of an initiative stale for >= 14 days', async () => {
    mocks.initiativeFindMany.mockResolvedValue([
      {
        id: 'init-1',
        orgId: ORG_ID,
        title: 'Acme expansion',
        lastActivityAt: new Date('2026-06-10T00:00:00Z'), // 21 days stale
        ownerId: 'owner-1',
      },
    ]);
    mocks.notificationFindFirst.mockResolvedValue(null);

    const created = await scanKamStaleness(NOW, log);

    expect(created).toBe(1);
    expect(mocks.notificationCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          orgId: ORG_ID,
          userId: 'owner-1',
          type: 'system',
          entityType: 'kam_initiative',
          entityId: 'init-1',
        }),
      }),
    );
  });

  it('does not nudge an initiative active within the last 14 days', async () => {
    mocks.initiativeFindMany.mockResolvedValue([
      {
        id: 'init-1',
        orgId: ORG_ID,
        title: 'Fresh account',
        lastActivityAt: new Date('2026-06-25T00:00:00Z'), // 6 days
        ownerId: 'owner-1',
      },
    ]);

    const created = await scanKamStaleness(NOW, log);

    expect(created).toBe(0);
    expect(mocks.notificationCreate).not.toHaveBeenCalled();
  });
});
