// The nav badge (GET /api/tasks/summary openForUser) and the Tasks page
// (GET /api/tasks?scope=mine) must count the same rows. Seven open tasks due
// before today plus one due on the UTC day is the reported 7 vs 8: the old
// badge counted only overdue, and the page listed every task.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@bidstack/db';

import { buildServer } from '../server.js';
import {
  createIsolatedOrg,
  dropIsolatedOrg,
  useIsolatedOrgAuth,
} from '../test-support/isolated-org.js';
import { purgeAuditRows } from '../test-support/purge-audit-rows.js';

let server: Awaited<ReturnType<typeof buildServer>>;
let dbReachable = false;
let orgId: string | null = null;
let restoreAuth: (() => void) | null = null;
const createdTaskIds: string[] = [];

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  const org = await createIsolatedOrg('open-tasks-for-user');
  orgId = org.orgId;
  restoreAuth = useIsolatedOrgAuth(org.clerkOrg);
  await prisma.task.deleteMany({ where: { orgId: org.orgId } });
  server = await buildServer();
  await server.ready();
});

afterAll(async () => {
  for (const id of createdTaskIds) {
    await purgeAuditRows({ where: { targetType: 'task', targetId: id } });
  }
  if (server) await server.close();
  if (restoreAuth) restoreAuth();
  if (orgId) await dropIsolatedOrg(orgId);
  if (dbReachable) await prisma.$disconnect();
});

describe('open tasks for this user, over HTTP', () => {
  it('badge openForUser equals the Tasks page list on the due-today boundary', async () => {
    if (!dbReachable || !server || !orgId) {
      throw new Error('[skip] open tasks for this user — DATABASE_URL not reachable');
    }
    const users = await prisma.user.findMany({
      where: { orgId },
      orderBy: { createdAt: 'asc' },
      select: { email: true },
      take: 2,
    });
    const me = users[0]?.email;
    const other = users[1]?.email;
    if (!me || !other) throw new Error('isolated org is missing two users');

    const today = new Date().toISOString().slice(0, 10);
    async function create(title: string, dueDate: string, status: 'open' | 'done', assignee: string) {
      const res = await server.inject({
        method: 'POST',
        url: '/api/tasks',
        payload: { oppId: null, title, dueDate, status, assignee },
      });
      expect(res.statusCode).toBe(201);
      const id = (res.json() as { id: string }).id;
      createdTaskIds.push(id);
      return id;
    }

    for (let n = 0; n < 7; n += 1) {
      await create(`Synthetic overdue ${n + 1}`, '2020-01-01', 'open', me);
    }
    await create('Synthetic due today UTC', today, 'open', me);
    await create('Synthetic done', '2020-01-01', 'done', me);
    await create('Synthetic someone else', '2099-01-01', 'open', other);

    const summaryRes = await server.inject({ method: 'GET', url: '/api/tasks/summary' });
    expect(summaryRes.statusCode).toBe(200);
    const summary = summaryRes.json() as {
      openForUser: number;
      overdue: number;
      civilToday: string;
      timeZone: string;
    };
    expect(summary.timeZone).toBe('America/Sao_Paulo');

    const pageRes = await server.inject({ method: 'GET', url: '/api/tasks?scope=mine&limit=100' });
    expect(pageRes.statusCode).toBe(200);
    const page = pageRes.json() as { items: Array<{ dueDate: string | null; status: string }> };

    // The page lists the eight open tasks for this user. The old overdue
    // aggregate still excludes the one due today, which is why the badge
    // used to read 7.
    expect(page.items).toHaveLength(8);
    expect(page.items.filter((row) => row.dueDate === today)).toHaveLength(1);
    expect(summary.overdue).toBe(7);
    expect(summary.openForUser).toBe(page.items.length);
  });

  it('openForUser follows create, complete, and delete', async () => {
    if (!dbReachable || !server || !orgId) {
      throw new Error('[skip] open tasks refresh — DATABASE_URL not reachable');
    }
    const me = (
      await prisma.user.findFirst({
        where: { orgId },
        orderBy: { createdAt: 'asc' },
        select: { email: true },
      })
    )?.email;
    if (!me) throw new Error('isolated org is missing its user');

    const before = await server.inject({ method: 'GET', url: '/api/tasks/summary' });
    const start = (before.json() as { openForUser: number }).openForUser;

    async function create(title: string) {
      const res = await server.inject({
        method: 'POST',
        url: '/api/tasks',
        payload: {
          oppId: null,
          title,
          dueDate: '2026-11-21',
          status: 'open',
          assignee: me,
        },
      });
      expect(res.statusCode).toBe(201);
      const id = (res.json() as { id: string }).id;
      createdTaskIds.push(id);
      return id;
    }

    const completedId = await create('Synthetic complete');
    const deletedId = await create('Synthetic delete');
    const afterCreate = await server.inject({ method: 'GET', url: '/api/tasks/summary' });
    expect((afterCreate.json() as { openForUser: number }).openForUser).toBe(start + 2);

    const completed = await server.inject({
      method: 'PATCH',
      url: `/api/tasks/${completedId}`,
      payload: { status: 'done' },
    });
    expect(completed.statusCode).toBe(200);
    const afterComplete = await server.inject({ method: 'GET', url: '/api/tasks/summary' });
    expect((afterComplete.json() as { openForUser: number }).openForUser).toBe(start + 1);

    const deleted = await server.inject({ method: 'DELETE', url: `/api/tasks/${deletedId}` });
    expect(deleted.statusCode).toBe(204);
    const afterDelete = await server.inject({ method: 'GET', url: '/api/tasks/summary' });
    expect((afterDelete.json() as { openForUser: number }).openForUser).toBe(start);
  });
});
