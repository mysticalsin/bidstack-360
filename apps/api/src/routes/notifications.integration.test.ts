// Integration tests for the in-app notification center.
// WHY these assertions matter:
//   - a user must only ever see their OWN notifications (tenant + per-user
//     isolation) — a leak here exposes another rep's bid/override activity;
//   - the unread count drives the topbar badge, so it must track reads exactly;
//   - mark-read is a write and must stay org+user scoped (no marking someone
//     else's notification read).
// Pattern mirrors cross-sell.integration.test.ts: buildServer + inject against
// an isolated org; every fixture cleaned up in afterAll.
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
let stubUserId: string | null = null;
let restoreAuth: (() => void) | null = null;
const TITLE_TAG = 'NOTIF-TEST';

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  const org = await createIsolatedOrg('notifications');
  orgId = org.orgId;
  restoreAuth = useIsolatedOrgAuth(org.clerkOrg);
  // Stub auth resolves to the oldest user in the isolated org - mirror that here so
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
  if (restoreAuth) restoreAuth();
  if (orgId) await dropIsolatedOrg(orgId);
  if (dbReachable) await prisma.$disconnect();
});

const t = makeSkipIfNoDb(() => dbReachable && !!orgId && !!stubUserId);

describe('notifications routes', () => {
  t(
    'list returns my notifications with an accurate unread count, then mark-read clears it',
    async () => {
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
    },
  );

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

describe('notification prefs routes', () => {
  afterAll(async () => {
    if (stubUserId) await prisma.notificationPref.deleteMany({ where: { userId: stubUserId! } });
  });

  t('GET returns the shared defaults when no row exists yet', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/notifications/prefs' });
    expect(res.statusCode).toBe(200);
    // WHY this must match DEFAULT_NOTIFICATION_PREFS exactly: an absent row
    // must read identically to what a fresh user actually receives — the API
    // contract the web NotificationPrefsSection toggles render against.
    expect(res.json()).toEqual({
      emailDigest: true,
      mentionPush: true,
      taskDueSoon: true,
      dealStageChange: false,
    });
  });

  t('PUT persists the toggles server-side, so a follow-up GET reflects them', async () => {
    const put = await server.inject({
      method: 'PUT',
      url: '/api/notifications/prefs',
      payload: { emailDigest: false, mentionPush: false, taskDueSoon: false, dealStageChange: true },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toMatchObject({ taskDueSoon: false, dealStageChange: true });

    // Proves this is server-persisted (not the old localStorage-only toggle) —
    // a fresh GET on the same account must see the write.
    const after = await server.inject({ method: 'GET', url: '/api/notifications/prefs' });
    expect(after.json()).toEqual({
      emailDigest: false,
      mentionPush: false,
      taskDueSoon: false,
      dealStageChange: true,
    });
  });

  t('PUT upserts — a second write on an existing row updates it, not duplicates it', async () => {
    await server.inject({
      method: 'PUT',
      url: '/api/notifications/prefs',
      payload: { emailDigest: true, mentionPush: true, taskDueSoon: true, dealStageChange: false },
    });
    const rows = await prisma.notificationPref.findMany({ where: { userId: stubUserId! } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ taskDueSoon: true, dealStageChange: false });
  });
});
