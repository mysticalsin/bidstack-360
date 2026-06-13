// Integration tests for the in-app notification center.
// WHY these assertions matter:
//   - a user must only ever see their OWN notifications (tenant + per-user
//     isolation) — a leak here exposes another rep's bid/override activity;
//   - the unread count drives the topbar badge, so it must track reads exactly;
//   - mark-read is a write and must stay org+user scoped (no marking someone
//     else's notification read).
// Pattern mirrors cross-sell.integration.test.ts: buildServer + inject against
// the seed org; every fixture cleaned up in afterAll.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@bidstack/db';

import { buildServer } from '../server.js';

let server: Awaited<ReturnType<typeof buildServer>>;
let dbReachable = false;
let orgId: string | null = null;
let stubUserId: string | null = null;
const TITLE_TAG = 'NOTIF-TEST';

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  const org = await prisma.org.findUnique({ where: { clerkOrg: 'org_seed_mantu' } });
  orgId = org?.id ?? null;
  if (!orgId) return;
  // Stub auth resolves to the oldest user in the seed org — mirror that here so
  // fixtures land on the same identity the injected requests authenticate as.
  const user = await prisma.user.findFirst({ where: { orgId }, orderBy: { createdAt: 'asc' } });
  stubUserId = user?.id ?? null;
  server = await buildServer();
  await server.ready();
});

afterAll(async () => {
  if (orgId) {
    await prisma.notification.deleteMany({ where: { orgId, title: { startsWith: TITLE_TAG } } });
  }
  if (server) await server.close();
  if (dbReachable) await prisma.$disconnect();
});

const t = (name: string, fn: () => Promise<void>) =>
  it(name, async () => {
    if (!dbReachable || !orgId || !stubUserId) {
      throw new Error(`[skip] ${name} — DB/seed org/user unavailable`);
    }
    await fn();
  });

describe('notifications routes', () => {
  t('list returns my notifications with an accurate unread count, then mark-read clears it', async () => {
    const created = await prisma.notification.create({
      data: {
        orgId: orgId!,
        userId: stubUserId!,
        type: 'assignment',
        title: `${TITLE_TAG} assigned`,
        body: 'You own a new action',
        url: '/accounts/acme',
      },
    });

    const list = await server.inject({ method: 'GET', url: '/api/notifications' });
    expect(list.statusCode).toBe(200);
    const body = list.json() as {
      items: { id: string; readAt: string | null }[];
      unread: number;
    };
    const mine = body.items.find((n) => n.id === created.id);
    expect(mine).toBeDefined();
    expect(mine?.readAt).toBeNull();
    expect(body.unread).toBeGreaterThanOrEqual(1);
    const unreadBefore = body.unread;

    const read = await server.inject({
      method: 'PATCH',
      url: `/api/notifications/${created.id}/read`,
    });
    expect(read.statusCode).toBe(200);
    expect((read.json() as { readAt: string | null }).readAt).not.toBeNull();

    const after = await server.inject({ method: 'GET', url: '/api/notifications' });
    expect((after.json() as { unread: number }).unread).toBe(unreadBefore - 1);
  });

  t('unreadOnly=true hides already-read notifications', async () => {
    const unread = await prisma.notification.create({
      data: { orgId: orgId!, userId: stubUserId!, type: 'system', title: `${TITLE_TAG} fresh` },
    });
    const read = await prisma.notification.create({
      data: {
        orgId: orgId!,
        userId: stubUserId!,
        type: 'system',
        title: `${TITLE_TAG} stale`,
        readAt: new Date(),
      },
    });

    const res = await server.inject({ method: 'GET', url: '/api/notifications?unreadOnly=true' });
    expect(res.statusCode).toBe(200);
    const ids = (res.json() as { items: { id: string }[] }).items.map((n) => n.id);
    expect(ids).toContain(unread.id);
    expect(ids).not.toContain(read.id);
  });

  t('read-all clears every unread notification for the caller', async () => {
    await prisma.notification.create({
      data: { orgId: orgId!, userId: stubUserId!, type: 'system', title: `${TITLE_TAG} bulk` },
    });
    const res = await server.inject({ method: 'POST', url: '/api/notifications/read-all' });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { updated: number }).updated).toBeGreaterThanOrEqual(1);

    const after = await server.inject({ method: 'GET', url: '/api/notifications' });
    expect((after.json() as { unread: number }).unread).toBe(0);
  });

  t("another user's notification is invisible and cannot be marked read", async () => {
    // A second user in the SAME org — proves per-user (not just per-org) scoping.
    const other = await prisma.user.create({
      data: {
        orgId: orgId!,
        clerkUser: `u_notif_other_${Date.now()}`,
        email: `notif-other-${Date.now()}@t.local`,
        name: 'Other',
      },
    });
    const theirs = await prisma.notification.create({
      data: { orgId: orgId!, userId: other.id, type: 'system', title: `${TITLE_TAG} theirs` },
    });
    try {
      const list = await server.inject({ method: 'GET', url: '/api/notifications' });
      const ids = (list.json() as { items: { id: string }[] }).items.map((n) => n.id);
      expect(ids).not.toContain(theirs.id);

      const read = await server.inject({
        method: 'PATCH',
        url: `/api/notifications/${theirs.id}/read`,
      });
      expect(read.statusCode).toBe(404);
    } finally {
      await prisma.notification.deleteMany({ where: { userId: other.id } });
      await prisma.user.delete({ where: { id: other.id } });
    }
  });
});
