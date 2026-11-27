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

  it('reads an aged fixture task as due tomorrow in demo, and leaves it out of the overdue batch', async () => {
    // WHY: the seven open fixture tasks are dated 2026-05-12 through 2026-05-23.
    // On 2026-11-27 every stored date is past, so this scan raises an overdue
    // nudge for each of them and they sort first in the 1000-row batch.
    const now = new Date('2026-11-27T12:00:00.000Z');
    const earlyDue = new Date('2026-05-12T00:00:00.000Z');
    const farDue = new Date('2026-05-23T00:00:00.000Z');
    const early = {
      id: '00000000-0000-4000-8000-000000010003',
      orgId: ORG_ID,
      title: 'Final commercial review — Rush University',
      dueDate: earlyDue,
      assigneeId: 'user-1',
    };
    mocks.notificationFindFirst.mockResolvedValue(null);
    mocks.taskFindMany.mockResolvedValue([
      early,
      {
        id: '00000000-0000-4000-8000-000000010005',
        orgId: ORG_ID,
        title: 'Confirm MAPFRE budget owner',
        dueDate: farDue,
        assigneeId: 'user-1',
      },
    ]);

    const created = await scanTaskDueAlerts(now, log, 'demo');

    expect(created).toBe(1);
    expect(mocks.notificationCreate).toHaveBeenCalledTimes(1);
    expect(mocks.notificationCreate.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          title: 'Task due tomorrow: Final commercial review — Rush University',
          entityId: early.id,
        }),
      }),
    );
    expect(early.dueDate).toBe(earlyDue);
    const excluded = (mocks.taskFindMany.mock.calls[0]?.[0].where.NOT?.OR ?? []).map(
      (row: { id: string }) => row.id,
    );
    expect(excluded).toContain('00000000-0000-4000-8000-000000010005');
    expect(excluded).not.toContain(early.id);
  });

  it('slides an aged fixture task when POLO_DATA_MODE is unset, and keeps it when real', async () => {
    // WHY: the hosted demo leaves POLO_DATA_MODE unset. That is demo, same as
    // getPoloDataMode. Exact real must keep the stored May date.
    const now = new Date('2026-11-27T12:00:00.000Z');
    const row = {
      id: '00000000-0000-4000-8000-000000010003',
      orgId: ORG_ID,
      title: 'Final commercial review — Rush University',
      dueDate: new Date('2026-05-12T00:00:00.000Z'),
      assigneeId: 'user-1',
    };
    const previous = process.env.POLO_DATA_MODE;
    try {
      delete process.env.POLO_DATA_MODE;
      mocks.notificationFindFirst.mockResolvedValue(null);
      mocks.taskFindMany.mockResolvedValue([row]);
      expect(await scanTaskDueAlerts(now, log)).toBe(1);
      expect(mocks.notificationCreate.mock.calls[0]?.[0].data.title).toBe(
        'Task due tomorrow: Final commercial review — Rush University',
      );

      process.env.POLO_DATA_MODE = 'real';
      mocks.notificationCreate.mockClear();
      expect(await scanTaskDueAlerts(now, log)).toBe(1);
      expect(mocks.notificationCreate.mock.calls[0]?.[0].data.title).toBe(
        'Task overdue: Final commercial review — Rush University',
      );
    } finally {
      if (previous === undefined) delete process.env.POLO_DATA_MODE;
      else process.env.POLO_DATA_MODE = previous;
    }
  });

  it('keeps the stored May date when the mode is real or not exactly demo', async () => {
    const now = new Date('2026-11-27T12:00:00.000Z');
    const row = {
      id: '00000000-0000-4000-8000-000000010003',
      orgId: ORG_ID,
      title: 'Final commercial review — Rush University',
      dueDate: new Date('2026-05-12T00:00:00.000Z'),
      assigneeId: 'user-1',
    };
    mocks.notificationFindFirst.mockResolvedValue(null);
    for (const mode of ['real', 'Demo', 'DEMO', 'demo-x', ' demo', 'notdemo'] as const) {
      mocks.taskFindMany.mockResolvedValue([row]);
      mocks.notificationCreate.mockClear();
      const created = await scanTaskDueAlerts(now, log, mode);
      expect(created).toBe(1);
      expect(mocks.notificationCreate.mock.calls[0]?.[0].data.title).toBe(
        'Task overdue: Final commercial review — Rush University',
      );
      expect(mocks.taskFindMany.mock.calls.at(-1)?.[0].where.NOT).toBeUndefined();
    }
  });

  it('does not slide a live task or a fixture task whose date was edited', async () => {
    const now = new Date('2026-11-27T12:00:00.000Z');
    mocks.notificationFindFirst.mockResolvedValue(null);
    mocks.taskFindMany.mockResolvedValue([
      {
        id: 'task-live',
        orgId: ORG_ID,
        title: 'Live follow-up',
        dueDate: new Date('2026-05-12T00:00:00.000Z'),
        assigneeId: 'user-1',
      },
      {
        id: '00000000-0000-4000-8000-000000010003',
        orgId: ORG_ID,
        title: 'Edited fixture',
        dueDate: new Date('2026-05-13T00:00:00.000Z'),
        assigneeId: 'user-2',
      },
    ]);

    const created = await scanTaskDueAlerts(now, log, 'demo');

    expect(created).toBe(2);
    const titles = mocks.notificationCreate.mock.calls.map((call) => call[0].data.title);
    expect(titles).toEqual([
      'Task overdue: Live follow-up',
      'Task overdue: Edited fixture',
    ]);
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
