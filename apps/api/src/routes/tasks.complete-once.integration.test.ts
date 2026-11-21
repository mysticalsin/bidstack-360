// Marking a task done must emit task.completed once.
//
// The handler read status, wrote status, then fired the webhook whenever the
// body said done. Two parallel "mark done" clicks both observed open, both
// wrote done, and both recorded an outbox row. A second click after the task
// was already done did the same, because the webhook did not look at the
// previous status.

import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect } from 'vitest';

import { prisma } from '@bidstack/db';

import { buildServer } from '../server.js';
import {
  createIsolatedOrg,
  dropIsolatedOrg,
  useIsolatedOrgAuth,
} from '../test-support/isolated-org.js';
import { makeSkipIfNoDb } from '../test-support/skip-if-no-db.js';

let server: Awaited<ReturnType<typeof buildServer>>;
let dbReachable = false;
let orgId: string | null = null;
let restoreAuth: (() => void) | null = null;
const previousOutbox = process.env.WEBHOOK_OUTBOX_ENABLED;

beforeAll(async () => {
  process.env.WEBHOOK_OUTBOX_ENABLED = 'true';
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  const org = await createIsolatedOrg('task-complete');
  orgId = org.orgId;
  restoreAuth = useIsolatedOrgAuth(org.clerkOrg);
  await prisma.webhookSubscription.create({
    data: {
      orgId: org.orgId,
      url: 'https://example.test/hooks/task-complete',
      secret: `synthetic-${randomUUID()}`,
      events: ['task.completed'],
      active: true,
    },
  });
  server = await buildServer();
  await server.ready();
}, 120_000);

afterAll(async () => {
  if (previousOutbox === undefined) delete process.env.WEBHOOK_OUTBOX_ENABLED;
  else process.env.WEBHOOK_OUTBOX_ENABLED = previousOutbox;
  if (server) await server.close();
  if (restoreAuth) restoreAuth();
  if (orgId) await dropIsolatedOrg(orgId);
  if (dbReachable) await prisma.$disconnect();
});

const skipIfNoDb = makeSkipIfNoDb(() => dbReachable && !!orgId);

async function completedEvents(taskId: string): Promise<number> {
  return prisma.webhookOutbox.count({
    where: {
      orgId: orgId!,
      event: 'task.completed',
      payload: { path: ['id'], equals: taskId },
    },
  });
}

async function settleCompletedEvents(taskId: string): Promise<number> {
  let last = -1;
  let stable = 0;
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline && stable < 3) {
    const count = await completedEvents(taskId);
    if (count === last && count > 0) stable += 1;
    else stable = 0;
    last = count;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  return last;
}

describe('task completion concurrency', () => {
  skipIfNoDb(
    'two parallel mark-done requests record task.completed once',
    async () => {
      const task = await prisma.task.create({
        data: { orgId: orgId!, title: `Complete once ${randomUUID().slice(0, 8)}`, status: 'open' },
      });

      const [first, second] = await Promise.all([
        server.inject({
          method: 'PATCH',
          url: `/api/tasks/${task.id}`,
          payload: { status: 'done' },
        }),
        server.inject({
          method: 'PATCH',
          url: `/api/tasks/${task.id}`,
          payload: { status: 'done' },
        }),
      ]);

      expect([first.statusCode, second.statusCode].sort()).toEqual([200, 200]);
      expect(await settleCompletedEvents(task.id)).toBe(1);

      const again = await server.inject({
        method: 'PATCH',
        url: `/api/tasks/${task.id}`,
        payload: { status: 'done', title: 'Still done' },
      });
      expect(again.statusCode).toBe(200);
      expect((again.json() as { title: string }).title).toBe('Still done');
      expect(await settleCompletedEvents(task.id)).toBe(1);
    },
  );
});
